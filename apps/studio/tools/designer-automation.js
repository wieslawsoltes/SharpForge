/** First-use automation awaits the controller; active designers retain synchronous document operations. */
export function contributeDesignerAutomation(automation, context) {
  const use = action => (...args) => {
    const tools = context.loadDesigner?.() ?? context.designerTools;
    return tools?.then ? tools.then(instance => action(instance, ...args)) : action(tools, ...args);
  };
  return automation.contributeAutomation('', { designer: {
    connect: use((tools, uri) => tools.sourceSync.connect(uri)),
    disconnect: use(tools => tools.sourceSync.disconnect()),
    readSource: use((tools, options) => tools.sourceSync.read(options)),
    writeSource: use(tools => tools.sourceSync.write()),
    setAutoSync: use((tools, value) => tools.sourceSync.setAuto(value)),
    setView: use((tools, mode) => tools.chrome.setMode(mode)),
    open: () => context.execute('designer'),
    get: use(tools => tools.snapshot()),
    load: use((tools, value, options) => {
      if (typeof tools.load === 'function') return tools.load(value, options);
      tools.ensure();
      tools.replace(value, options);
      return tools.snapshot();
    }),
    select: use((tools, ids) => tools.document.select(ids)),
    add: use((tools, type, parent) => tools.document.add(type, parent)),
    set: use((tools, key, value, ids) => tools.document.setProperty(key, value, ids)),
    clear: use((tools, key, ids) => tools.document.setProperty(key, undefined, ids)),
    move: use((tools, id, parent, index) => tools.document.move(id, parent, index)),
    remove: use((tools, ids) => tools.document.remove(ids)),
    style: use((tools, key, value) => tools.document.setStyle(key, value)),
    template: use((tools, key, value) => tools.document.setTemplate(key, value)),
    reference: use((tools, kind, key, ids) => tools.document.setReference(kind, key, ids)),
    tracks: use((tools, id, rows, columns) => tools.document.tracks(id, rows, columns)),
    undo: use((tools, redo) => typeof tools.undo === 'function' ? tools.undo(redo) : tools.document.undo(redo)),
    action: use((tools, action) => tools.action(action)),
    attach: use((tools, sessionId, options) => tools.attach(sessionId, options)),
    apply: use(tools => tools.applyLive())
  } });
}
