import { WatchWindowState } from './state.js';
import { WatchWindowModel } from './model.js';
import { mountWatchWindow } from './view.js';

/** Install before the first docking.sync so persisted Watch identities have a factory during layout migration. */
export function installWatchWindows({ docking, sessions, commands, storage, onError = () => {} }) {
  const state = new WatchWindowState({ storage, onError });
  const instances = new Map();
  let disposed = false;
  const visible = id => {
    if (!docking.layout.panels.has(id)) return false;
    if (docking.host.popouts.has(id)) return true;
    const location = docking.layout.locate(id);
    if (location.kind === 'autoHide') return docking.host.autoPanel === id;
    return location.kind !== 'closed' && location.group?.active === id;
  };
  const removeFactory = docking.registerToolKind('watch', record => {
    const host = docking.host.element.ownerDocument.createElement('div');
    host.className = 'panel-content dock-tool-content wb-tool wb-watch';
    host.setAttribute('data-tool', record.id);
    const model = new WatchWindowModel({ record, sessions, state, visible: () => visible(record.id), onError });
    const view = mountWatchWindow(host, { model, onError });
    instances.set(record.id, { model, view, element: host });
    return host;
  }, { limit: 4, title: 'Watch' });
  const offLayout = docking.layout.subscribe(() => {
    for (const [id, { model, view }] of instances) {
      if (!docking.layout.panels.has(id)) {
        model.dispose();
        view.dispose();
        instances.delete(id);
      } else model.refresh();
    }
  });
  const open = (instance = 2, options = {}) => {
    if (disposed) throw new Error('Watch windows are disposed');
    const id = docking.createTool('watch', instance, options);
    docking.activate(id);
    instances.get(id)?.model.refresh();
    return id;
  };
  const descriptors = Array.from({ length: 4 }, (_, index) => {
    const instance = index + 1;
    return { id: `window.watch${instance}`, title: `Watch ${instance}`, category: 'Debug',
      enabled: () => !disposed, execute: () => open(instance) };
  });
  const removeCommands = descriptors.map(command => commands.register(command));
  return {
    open, descriptors, get: id => instances.get(id),
    dispose() {
      if (disposed) return;
      disposed = true;
      offLayout();
      for (const remove of removeCommands) remove();
      removeFactory();
      for (const [id, { model, view }] of instances) {
        model.dispose();
        view.dispose();
        docking.unregisterPanel(id);
      }
      instances.clear();
    }
  };
}
