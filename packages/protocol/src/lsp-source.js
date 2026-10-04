/** LSP wire forms for the same validated source operations used by the editor worker. */
export function renameWorkspaceEdit(server, parameters) {
  const action = server.refactoring.rename(parameters.textDocument.uri, server.offset(parameters), parameters.newName);
  const changes = {};
  for (const edit of action.edits) {
    (changes[edit.uri] ??= []).push({range: server.location(edit).range, newText: edit.newText});
  }
  if (!server.documentChanges) return {changes};
  return {documentChanges: Object.entries(changes).map(([uri, edits]) => ({
    textDocument: {uri, version: server.source(uri).version}, edits
  }))};
}

export function prepareRename(server, parameters) {
  const uri = parameters.textDocument.uri;
  const offset = server.offset(parameters);
  if (!server.workspace.documents.has(uri) || !server.language.reference(uri, offset)) return null;
  const target = server.language.prepareRename(uri, offset);
  return {range: server.location({...target, uri}).range, placeholder: target.placeholder};
}

export function workspaceSymbols(server, query = '') {
  return [...server.workspace.documents.keys()].flatMap(uri => server.language.documentSymbols(uri))
    .filter(symbol => symbol.name.toLowerCase().includes(query.toLowerCase())).slice(0, 1000);
}
