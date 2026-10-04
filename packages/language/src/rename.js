import {keywords} from '@sharpforge/syntax';
import {prepareTypeRename as prepareCompilationTypeRename} from '@sharpforge/compiler';

const identifierBefore = /[\p{L}\p{N}\p{M}\p{Pc}_\u200c\u200d]$/u;
const identifierAfter = /^[\p{L}\p{N}\p{M}\p{Pc}_\u200c\u200d]/u;

export function renameTarget(workspace, uri, offset) {
  const model = workspace.sourceModel();
  const reference = model?.referenceAt(uri, offset);
  const record = reference && model.symbolAt(uri, offset);
  if (!record || !reference) throw new Error('No bound source symbol at this position');
  if (!workspace.documents.has(record.uri)) throw new Error('Generated and metadata declarations are read-only');
  const symbol = model.symbolsById.get(record.id);
  if (!['NamedType', 'Method', 'Field', 'Property', 'Event', 'Local', 'Parameter'].includes(symbol.kind)) {
    throw new Error('This symbol cannot be renamed');
  }
  if (symbol.kind === 'NamedType') {
    for (const file of workspace.documentStore?.entries.values() ?? []) {
      if (/\.cs$/i.test(file.path) && file.compile !== false && !workspace.documents.has(file.path)) {
        const error = new Error('Open all compilation inputs before renaming a type; unloaded references cannot be skipped.');
        error.code = 'SFL2401';
        throw error;
      }
    }
  }
  return {model, reference, record, symbol};
}

function textOccurrences(source, span, oldName, newName) {
  const edits = [];
  const segment = source.text.slice(span.start, span.end);
  let position = 0;
  while ((position = segment.indexOf(oldName, position)) !== -1) {
    const end = position + oldName.length;
    const left = segment.slice(Math.max(0, position - 2), position);
    const right = segment.slice(end, end + 2);
    if (!identifierBefore.test(left) && !identifierAfter.test(right)) {
      edits.push({uri: source.uri, start: span.start + position, end: span.start + end, newText: newName, version: source.version});
    }
    position = end;
  }
  return edits;
}

function optionalTextEdits(workspace, oldName, newName, options) {
  if (!options.includeComments && !options.includeStrings) return [];
  const edits = [];
  for (const [uri, document] of workspace.documents) {
    const syntax = workspace.syntax(uri).syntax;
    const spans = new Map();
    for (const token of syntax.descendantTokens()) {
      if (options.includeStrings && /StringLiteralToken$|InterpolatedStringTextToken$/.test(token.kind)) {
        spans.set(token.span.start, token.span);
      }
      if (options.includeComments) for (const trivia of [...token.leadingTrivia, ...token.trailingTrivia]) {
        if (/CommentTrivia$/.test(trivia.kind)) spans.set(trivia.span.start, trivia.span);
      }
    }
    for (const span of spans.values()) edits.push(...textOccurrences(document.source, span, oldName, newName));
  }
  return edits;
}

function renamedFile(workspace, record, symbol, newName) {
  if (symbol.kind !== 'NamedType') throw new Error('Rename file requires a source type');
  const slash = record.uri.lastIndexOf('/');
  const filename = record.uri.slice(slash + 1);
  if (filename !== record.name + '.cs') throw new Error('Rename file requires the declaring filename to match the type name');
  const newUri = record.uri.slice(0, slash + 1) + newName + '.cs';
  if (newUri === record.uri) return [];
  if (workspace.documents.has(newUri) || workspace.generatedDocuments.has(newUri)) throw new Error('Rename destination already exists');
  return [{kind: 'rename', oldUri: record.uri, newUri, version: workspace.documents.get(record.uri).source.version}];
}

/** Creates an immutable source rename intent. Refactoring validates the candidate before a host can commit it. */
export function renameSource(workspace, uri, offset, newName, options = {}) {
  if (!/^[\p{L}_][\p{L}\p{N}\p{M}\p{Pc}_]*$/u.test(newName) || keywords.has(newName)) {
    throw new Error('The new name must be a non-keyword C# identifier');
  }
  const {model, record, symbol} = renameTarget(workspace, uri, offset);
  for (const [other, otherRecord] of model.records) {
    if (!otherRecord || other === symbol || otherRecord.name !== newName || other.containingSymbol !== symbol.containingSymbol) continue;
    if (other.kind === symbol.kind || ['Field', 'Property', 'Event', 'NamedType'].includes(other.kind)) {
      throw new Error(`'${newName}' conflicts with an existing symbol`);
    }
  }
  const references = model.references.filter(reference => reference.symbolId === record.id);
  if (references.some(reference => !workspace.documents.has(reference.uri))) throw new Error('Rename would edit read-only generated source');
  const edits = references.map(reference => ({uri: reference.uri, start: reference.start, end: reference.end,
    version: reference.version, newText: newName}));
  edits.push(...optionalTextEdits(workspace, record.name, newName, options));
  const unique = [...new Map(edits.map(edit => [`${edit.uri}:${edit.start}:${edit.end}`, edit])).values()]
    .sort((a, b) => a.uri.localeCompare(b.uri) || a.start - b.start);
  return {edits: unique, resources: options.renameFile ? renamedFile(workspace, record, symbol, newName) : [],
    symbolId: record.id, symbol: record, newName};
}

/** The historical edit-array API refuses resource intent; callers must preserve it through renamePlan. */
export function renameSourceText(workspace, uri, offset, newName, options = {}) {
  const plan = renameSource(workspace, uri, offset, newName, options);
  if (plan.resources.length) throw new Error('A file rename requires renamePlan and an atomic resource host');
  return plan.edits;
}

export function prepareSourceRename(workspace, uri, offset) {
  const {record, reference, symbol} = renameTarget(workspace, uri, offset);
  const capabilities = ['comments', 'strings'];
  if (symbol.kind === 'NamedType' && record.uri.slice(record.uri.lastIndexOf('/') + 1) === record.name + '.cs') capabilities.push('file');
  return {start: reference.start, end: reference.end, placeholder: record.name, capabilities,
    version: workspace.documents.get(uri)?.source.version, symbolId: record.id,
    declaration: {uri: record.uri, start: record.start, end: record.end}};
}

const unavailable = reason => ({available: false, reason,
  diagnostic: {code: 'SFL2401', severity: 'warning', message: reason}, edits: [], documents: []});

/** Prepare versioned edits without mutating documents. Every compilation input must be loaded and every target editable. */
export function prepareWorkspaceTypeRename(workspace, uri, offset, newName, options = {}) {
  options.signal?.throwIfAborted();
  for (const record of workspace.documentStore?.entries.values() ?? []) {
    if (/\.cs$/i.test(record.path) && record.compile !== false && !workspace.documents.has(record.path)) {
      return unavailable('Open all compilation inputs before renaming a type; unloaded references cannot be skipped.');
    }
  }
  if (workspace.extensions) workspace.compile({signal: options.signal});
  const inputs = [...workspace.documents.keys(), ...workspace.generatedDocuments.keys()].map(path => workspace.syntax(path));
  const plan = prepareCompilationTypeRename(inputs, {uri, offset, newName, ...options, compilationOptions: workspace.compilationOptions});
  if (!plan.available) return {...plan, documents: []};
  if (plan.edits.some(edit => !workspace.documents.has(edit.uri))) return unavailable('Type rename would edit read-only generated source.');
  return {...plan, revision: workspace.revision,
    edits: plan.edits.map(edit => ({...edit, version: workspace.documents.get(edit.uri).source.version})),
    documents: [...workspace.documents.keys()].map(path => {
      const source = workspace.documents.get(path).source;
      return {uri: path, text: source.text, version: source.version};
    })};
}

/** Compatibility helper retains the historical text-only result through the current bound-source planner. */
export function renameLanguageSymbol(service, uri, offset, newName, options = {}) {
  return renameSourceText(service.workspace, uri, offset, newName, options);
}
