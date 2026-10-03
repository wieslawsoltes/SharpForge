/** Deterministic automation addresses a URI explicitly, so acceptance tests cannot accidentally edit the active singleton. */
export function contributeDesignerDocumentAutomation(automation, {documents}) {
  const session = uri => {
    const value = documents.get(uri);
    if (!value) throw new Error(`Designer session is not open: ${uri}`);
    return value;
  };
  const snapshot = uri => {
    const value = session(uri);
    return {
      ...value.snapshot(),
      document: value.document.snapshot(),
      revision: value.document.revision,
      undoDepth: value.document.undoStack.length,
      redoDepth: value.document.redoStack.length,
      sourceSync: value.sourceSync?.snapshot() ?? null,
      disposed: value.disposed
    };
  };
  return automation.contributeAutomation('designerDocuments', {
    list: () => documents.snapshot(),
    get: snapshot,
    probe: uri => documents.probe(uri),
    open: async (uri, mode = 'design') => { await documents.open(uri, mode); return snapshot(uri); },
    setView: (uri, value) => { session(uri).setViewState(value); return snapshot(uri); },
    select: (uri, ids) => session(uri).document.select(ids),
    setProperty: (uri, property, value, ids) => session(uri).document.setProperty(property, value, ids),
    undo: (uri, redo = false) => {
      const value = session(uri);
      const tools = value.documentHost.tools;
      return tools.undo ? tools.undo(redo) : value.document.undo(redo);
    },
    setAutoSync: (uri, enabled) => session(uri).sourceSync?.setAuto(enabled),
    recovery: () => documents.snapshot(),
    restoreRecovery: value => documents.restore(value)
  });
}
