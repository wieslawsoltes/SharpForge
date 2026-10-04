const DOCUMENT_LIMIT = 20000;

/** Preserve the compiler worker's complete-file synchronization contract behind its document lifecycle seam. */
export function syncWorkerDocuments(workspace, files) {
  if (!files) return;
  const names = new Set(files.map(file => file.uri));
  for (const uri of workspace.documents.keys()) if (!names.has(uri)) workspace.remove(uri);
  for (const file of files) workspace.update(file.uri, file.text, file.version);
}

/** Release only the exact source versions closed by the host; delayed messages cannot evict a newer reopened editor. */
export function registerDocumentLifecycleHandlers(handlers, {workspace}) {
  return handlers.registerHandler('releaseDocuments', ({documents}) => {
    if (!Array.isArray(documents) || documents.length > DOCUMENT_LIMIT) throw new RangeError('Document release batch limit exceeded');
    for (const document of documents) {
      if (!document || typeof document.uri !== 'string' || !document.uri || document.uri.length > 4096 ||
          !Number.isSafeInteger(document.version) || document.version < 1 || document.uri.startsWith('generated://')) {
        throw new TypeError('Document release requires a source URI and a positive safe version');
      }
    }
    const released = [];
    for (const document of documents) {
      if (workspace.documents.get(document.uri)?.source.version !== document.version) continue;
      workspace.remove(document.uri);
      released.push(document.uri);
    }
    return {released};
  });
}
