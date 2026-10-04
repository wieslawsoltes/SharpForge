import {validateDesign} from './model.js';
import {analyzeDesignSources} from './source-analysis.js';
import {sourcePropertyEdits, sourceRenameEdits} from './source-edit-properties.js';
import {sourceTreeEdits} from './source-edit-tree.js';
import {sourceResourceEdits} from './source-edit-resources.js';
import {applySourceEdits, coalesceSourceEdits, sameSourceValue, sourceIdentifier} from './source-text.js';
import {checkSourceCancellation, failSource} from './source-errors.js';
import {retainSourceDesignMetadata} from './source-design-metadata.js';
import {sourceCollectionEdits} from './source-edit-collections.js';
import {sourceResponsiveEdits} from './source-edit-responsive.js';
import {sourceSpanLookup} from './source-spans.js';

function namesFor(base, document) {
  const names = new Map();
  const taken = new Set(base.context.symbols.map(symbol => symbol.name));
  for (const node of document.nodes) {
    const binding = base.bindings[node.id];
    if (binding) {
      names.set(node.id, binding.name);
      continue;
    }
    const stem = sourceIdentifier(node.id);
    let name = stem;
    let suffix = 1;
    while (taken.has(name)) name = stem + '_' + suffix++;
    taken.add(name);
    names.set(node.id, name);
  }
  return names;
}

function treeShape(document) {
  return document.nodes.map(node => [node.id, node.type, node.projectType, node.children, node.rows, node.columns, node.style, node.template]);
}

/** Plans local source patches and symbol renames; returns all changed files for an atomic editor transaction. */
export function planDesignSourceUpdate(base, design, current = base.text, options = {}) {
  checkSourceCancellation(options.signal);
  assertSourceBaseline(base, current);
  if (design.previewOnly || base.document.previewOnly) {
    failSource('A synthetic preview document is read-only and cannot produce C# source edits.', null, 'SFSYNC_OWNERSHIP');
  }
  const next = validateDesign(design);
  const structural = !sameSourceValue(treeShape(base.document), treeShape(next))
    || !sameSourceValue(base.document.styles, next.styles) || !sameSourceValue(base.document.templates, next.templates);
  if (structural && base.unmanaged.length) {
    failSource('This method contains custom statements. Structural changes require an owned construction region.', null, 'SFSYNC_OWNERSHIP');
  }
  const before = new Map(base.document.nodes.map(node => [node.id, node]));
  for (const node of next.nodes) {
    if (Object.keys(node.collections ?? {}).some(property => property !== 'Items')) {
      failSource('Source collection editing currently supports the registered Items property', base.bindings[node.id]?.creation, 'SFSYNC_OWNERSHIP');
    }
    for (const key of ['bindings', 'resourceReferences', 'states']) {
      const oldValue = before.get(node.id)?.[key];
      const newValue = node[key];
      if (!sameSourceValue(oldValue ?? {}, newValue ?? {})) {
        failSource(`Source emission for '${key}' requires the matching framework authoring capability`,
          base.bindings[node.id]?.creation, 'SFSYNC_OWNERSHIP');
      }
    }
    if (before.has(node.id) && (before.get(node.id).type !== node.type || before.get(node.id).projectType !== node.projectType)) {
      failSource('Changing a constructed control type requires delete and insert', base.bindings[node.id].creation, 'SFSYNC_OWNERSHIP');
    }
  }
  for (const key of ['resources', 'themeResources', 'visualStates']) {
    if (!sameSourceValue(base.document[key] ?? {}, next[key] ?? {})) {
      failSource(`Source emission for '${key}' requires an explicit framework resource provider`, null, 'SFSYNC_OWNERSHIP');
    }
  }
  const names = namesFor(base, next);
  const edits = [];
  const external = [];
  for (const node of next.nodes) {
    const old = before.get(node.id);
    if (old && !base.bindings[node.id].inline && node.properties.Name && old.properties.Name !== node.properties.Name) {
      const binding = base.bindings[node.id];
      external.push(...sourceRenameEdits(base, binding, node.properties.Name));
      names.set(node.id, node.properties.Name);
    }
  }
  if (structural) sourceTreeEdits(base, next, names, edits, external);
  sourcePropertyEdits(base, next, names, edits);
  sourceCollectionEdits(base, next, names, edits);
  sourceResourceEdits(base, next, names, edits, external);
  const adaptive = sourceResponsiveEdits(base, next, names, options);
  const covered = sourceSpanLookup(adaptive.covered, base.uri);
  const ordinary = [...edits.filter(Boolean).map(edit => ({...edit, uri: base.uri})), ...external]
    .filter(edit => edit.start === edit.end || !covered(edit));
  return finishSourcePlan(base, [...ordinary, ...adaptive.edits], {
    ...options, document: next, structural: structural || adaptive.structural,
    identityHints: Object.fromEntries([...names].map(([id, name]) => [name, id]))
  });
}

export function assertSourceBaseline(base, current) {
  const sources = typeof current === 'string' ? [{uri: base.uri, text: current}] : current;
  if (!Array.isArray(sources)) failSource('Source snapshot must be text or versioned files', null, 'SFSYNC_CONFLICT');
  const originals = new Map(base.sources.map(file => [file.uri, file]));
  const seen = new Set();
  for (const source of sources) {
    if (seen.has(source.uri)) failSource('Duplicate source URI in current workspace', null, 'SFSYNC_CONFLICT');
    seen.add(source.uri);
    const original = originals.get(source.uri);
    if (!original || original.text !== source.text || source.version !== undefined && original.version !== undefined
      && source.version !== original.version) failSource('C# changed after synchronization. Read C# changes before applying designer edits.',
      null, 'SFSYNC_CONFLICT', {uri: source.uri});
  }
  if (typeof current !== 'string' && sources.length !== originals.size) failSource('Workspace files changed after synchronization', null, 'SFSYNC_CONFLICT');
}

/** Finishes a plan without mutating source, baselines, the active compiler, or the design document. */
export function finishSourcePlan(base, edits, options = {}) {
  checkSourceCancellation(options.signal);
  const grouped = new Map();
  for (const edit of edits.filter(Boolean)) {
    const uri = edit.uri ?? base.uri;
    if (!grouped.has(uri)) grouped.set(uri, []);
    grouped.get(uri).push(edit);
  }
  const changes = [];
  const sources = base.sources.map(file => {
    const fileEdits = grouped.get(file.uri);
    if (!fileEdits?.length) return {...file};
    if (file.readOnly || file.readonly) failSource('Source file is read-only: ' + file.uri, null, 'SFSYNC_OWNERSHIP', {uri: file.uri});
    grouped.delete(file.uri);
    const local = {...base, text: file.text, uri: file.uri};
    const merged = coalesceSourceEdits(local, fileEdits);
    const deletions = merged.filter(edit => edit.deletion).sort((left, right) => left.start - right.start);
    let deletionIndex = 0;
    const safeEdits = merged.sort((left, right) => left.start - right.start).filter(edit => {
      while (deletionIndex < deletions.length && deletions[deletionIndex].end < edit.start) deletionIndex++;
      const deletion = deletions[deletionIndex];
      if (edit.start === edit.end) return !deletion || deletion.start >= edit.start || deletion.end <= edit.end;
      return edit.deletion || !deletion || deletion.start > edit.start || deletion.end < edit.end;
    });
    const text = applySourceEdits(file.text, safeEdits);
    changes.push({uri: file.uri, before: file.text, text, expectedVersion: file.version, edits: safeEdits});
    return {...file, text};
  });
  if (grouped.size) failSource('Source plan references a missing partial file', null, 'SFSYNC_CONFLICT');
  let analysis = changes.length ? analyzeDesignSources(sources, {...base.options, ...options, uri: base.uri,
    methodName: base.method.name, previous: options.document ? {document: options.document, bindings: base.bindings} : base}) : base;
  if (!changes.length && options.document) {
    const document = validateDesign(retainSourceDesignMetadata(structuredClone(base.document), options.document));
    analysis = {...base, document};
    Object.defineProperty(analysis, 'context', {value: base.context, enumerable: false});
  }
  if (options.requireCompilation && !analysis.compilationSucceeded) {
    const errors = analysis.compilerDiagnostics.filter(diagnostic => diagnostic.severity === 'error');
    const first = errors[0];
    failSource('Candidate C# did not compile: ' + errors.map(diagnostic => diagnostic.message).join('; '),
      first ? {uri: first.uri, start: first.start, end: first.start + first.length} : null, 'SFSYNC_COMPILE', {diagnostics: errors});
  }
  const primary = changes.find(change => change.uri === base.uri);
  return {text: analysis.text, edits: primary?.edits ?? [], changes, sources, document: analysis.document, analysis,
    structural: !!options.structural, warnings: analysis.warnings, diagnostics: analysis.compilerDiagnostics,
    compilationSucceeded: analysis.compilationSucceeded, expectedSources: base.sources.map(file => ({...file}))};
}
