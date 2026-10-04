/** Resolve signatures through the compiler's public, revision-local bound invocation query. */
export function boundSignatureHelp(workspace, uri, offset, options) {
  if (!workspace.documents.has(uri) && !workspace.generatedDocuments.has(uri)) return null;
  return workspace.sourceModel()?.signatureHelp(uri, offset, options) ?? null;
}
