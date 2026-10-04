import {validateDesign} from './model.js';
import {generateDesignResourceXaml} from './resource-xaml.js';
import {sourceLiteralEdit} from './source-literals.js';
import {decodeDesignerResourceMarkup} from './resource-source-design.js';
import {discoverResourceSource, externalResourceReferences} from './resource-source-csharp.js';
import {DesignerResourceSourceError, resourceSourceCheck, resourceSourceFail,
  resourceSourceLocation, resourceTargetDiagnostic} from './resource-source-errors.js';

export {DesignerResourceSourceError} from './resource-source-errors.js';

const resourceTables = document => ({resources: document.resources ?? {}, styles: document.styles, templates: document.templates});
const resourceKeys = document => Object.values(resourceTables(document)).flatMap(table => Object.keys(table));

/** Syntax-only discovery of the exact generated C# resource-class form, without executing markup or application code. */
export function probeDesignerResourceSource(text, uri = 'DesignerResources.cs', options = {}) {
  try {
    const found = discoverResourceSource([{uri, text}], {...options, uri, probe: true});
    return {compatible: true, kind: 'resources', uri, className: found.className,
      method: 'Create', span: resourceSourceLocation(uri, found.literal).span, reason: null};
  } catch (error) {
    resourceSourceCheck(options.signal);
    if (!(error instanceof DesignerResourceSourceError)) throw error;
    return {compatible: false, kind: 'resources', uri, reason: error.message, diagnostic: error.diagnostic};
  }
}

/** Analysis can be preview-ready while native compilation is unavailable. That distinction is explicit in the result. */
export function analyzeDesignerResourceSources(sources, options = {}) {
  const context = discoverResourceSource(sources, options);
  const location = resourceSourceLocation(context.uri, context.literal);
  let document;
  try {
    document = decodeDesignerResourceMarkup(context.literal.value, {...options, name: context.owner.name});
  } catch (error) {
    resourceSourceCheck(options.signal);
    const markupSpan = error.diagnostic?.markupSpan;
    resourceSourceFail(error.code ?? 'SFD1887', error.message, {...location, ...(markupSpan ? {markupSpan} : {})});
  }
  const source = context.sources.find(file => file.uri === context.uri);
  const diagnostic = resourceTargetDiagnostic(context.uri, context.literal);
  return {version: 1, kind: 'resources', supported: true, previewReady: true,
    uri: context.uri, className: context.className, method: {name: 'Create', start: context.method.start, end: context.method.end},
    text: source.text, sources: context.sources, sourceVersion: source.version ?? 0, document,
    ownership: {version: 1, kind: 'resource-literal', uri: context.uri, span: location.span,
      capabilities: ['preview', 'stage', 'export', 'navigate'], statementCount: 1},
    compilationSucceeded: false, canApply: false,
    compilerDiagnostics: structuredClone(context.semantic.result.diagnostics ?? []),
    diagnostics: [diagnostic], targets: {nativeWinUI: {status: 'unavailable', reason: diagnostic.message},
      source: {status: 'unsupported', reason: diagnostic.message}, cil: {status: 'unsupported', reason: diagnostic.message}},
    externalReferences: externalResourceReferences(context, resourceKeys(document), options)};
}

/** Single-file convenience reader; options.sources supplies immutable sibling files for external-reference checks. */
export function readDesignerResourceSource(text, options = {}) {
  const uri = options.uri ?? 'DesignerResources.cs';
  const sources = options.sources?.map(source => source.uri === uri ? {...source, text} : source) ?? [{uri, text}];
  if (!sources.some(source => source.uri === uri)) sources.push({uri, text});
  return analyzeDesignerResourceSources(sources, {...options, uri});
}

function assertCurrent(baseline, sources) {
  if (!Array.isArray(sources)) resourceSourceFail('SFD1882', 'Current source files are required.', {uri: baseline.uri});
  const current = new Map(sources.map(source => [source.uri, source]));
  if (current.size !== sources.length || current.size !== baseline.sources.length) {
    resourceSourceFail('SFD1882', 'Resource source set changed. Reload before planning edits.', {uri: baseline.uri});
  }
  for (const previous of baseline.sources) {
    const source = current.get(previous.uri);
    if (!source || source.text !== previous.text || (source.version ?? 0) !== (previous.version ?? 0)) {
      resourceSourceFail('SFD1882', 'Resource source changed. Both source and staged resources are retained.', {uri: previous.uri});
    }
  }
  return current;
}

function assertResourceOnly(before, after) {
  const visual = document => Object.fromEntries(Object.entries(document)
    .filter(([key]) => !['resources', 'styles', 'templates', 'designer', 'designerOptions', 'editorState'].includes(key)));
  if (JSON.stringify(visual(before)) !== JSON.stringify(visual(after))) {
    resourceSourceFail('SFD1880', 'A resource class edits resources, styles and templates; its preview scaffold is not source-owned.');
  }
}

/** A reviewable literal-only candidate. canApply remains false until a real supported native compiler gate exists. */
export function planDesignerResourceSourceUpdate(baseline, input, currentSources = baseline.sources, options = {}) {
  resourceSourceCheck(options.signal);
  const current = assertCurrent(baseline, currentSources);
  const document = validateDesign(input?.value ?? input);
  assertResourceOnly(baseline.document, document);
  const file = current.get(baseline.uri);
  const same = JSON.stringify(resourceTables(document)) === JSON.stringify(resourceTables(baseline.document));
  if (same) return {kind: 'resources', noOp: true, canApply: false, compilationSucceeded: false,
    edits: [], changes: [], text: file.text, sources: currentSources.map(source => ({...source})), document,
    analysis: baseline, diagnostics: baseline.diagnostics, expectedSources: baseline.sources.map(source => ({...source}))};
  if (file.readOnly || file.readonly) resourceSourceFail('SFD1885', 'This resource source is read-only.', {uri: baseline.uri});
  const context = discoverResourceSource(currentSources, {...options, uri: baseline.uri, className: baseline.className});
  const afterKeys = new Set(resourceKeys(document));
  const removed = resourceKeys(baseline.document).filter(key => !afterKeys.has(key));
  const references = externalResourceReferences(context, removed, options);
  if (removed.length && references.length) resourceSourceFail('SFD1883',
    'Renaming or deleting this resource would leave unowned C# references. Update the references in Code view first.',
    {...references[0], relatedLocations: references});
  const markup = generateDesignResourceXaml(document);
  // The emitted candidate must remain inside the same closed, inert decoder before it is offered for export.
  decodeDesignerResourceMarkup(markup, {...options, name: context.owner.name});
  const edit = sourceLiteralEdit(file.text, context.literal, markup, 'string');
  const text = file.text.slice(0, edit.start) + edit.text + file.text.slice(edit.end);
  const sources = currentSources.map(source => source.uri === baseline.uri ? {...source, text} : {...source});
  const analysis = analyzeDesignerResourceSources(sources, {...options, uri: baseline.uri, className: baseline.className});
  return {kind: 'resources', noOp: false, canApply: false, compilationSucceeded: false, text, sources, document,
    edits: [edit], changes: [{uri: baseline.uri, before: file.text, text, expectedVersion: file.version ?? 0, edits: [edit]}],
    analysis, diagnostics: analysis.diagnostics, expectedSources: baseline.sources.map(source => ({...source}))};
}
