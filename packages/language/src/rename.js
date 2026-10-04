import {keywords} from '@sharpforge/syntax';
import {prepareTypeRename as prepareCompilationTypeRename} from '@sharpforge/compiler';

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

/** Preserve existing value-symbol rename and route type declarations through the complete semantic preview. */
export function renameLanguageSymbol(service, uri, offset, newName) {
  if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(newName) || keywords.has(newName)) {
    throw new Error('The new name must be a non-keyword C# identifier');
  }
  const symbol = service.symbolAt(uri, offset);
  if (!symbol || symbol.kind === 'class') {
    const plan = prepareWorkspaceTypeRename(service.workspace, uri, offset, newName);
    if (plan.available) return plan.edits;
    const error = new Error(plan.reason);
    error.code = plan.diagnostic.code;
    throw error;
  }
  const result = service.workspace.compile();
  if (result.symbols.some(other => other.id !== symbol.id && other.name === newName && other.kind === symbol.kind &&
    (other.method === symbol.method || other.owner === symbol.owner))) throw new Error(`'${newName}' conflicts with an existing symbol`);
  const references = service.references(uri, offset);
  if (references.some(reference => !service.workspace.documents.has(reference.uri))) throw new Error('Rename would edit read-only generated source');
  return references.map(reference => ({...reference, newText: newName}));
}
