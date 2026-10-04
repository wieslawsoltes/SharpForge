export const settle = () => new Promise(resolve => setImmediate(resolve));

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Only the loading status boundary needs DOM behavior in these controller tests. */
export function element() {
  const attributes = new Map();
  return { isConnected: true, children: [], attributes, ownerDocument: { createElement: () => element() },
    setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name),
    replaceChildren(...children) { this.children = children; } };
}

export function context() {
  const listeners = new Set(), commands = new Map(), errors = [];
  let groups = [];
  const docking = { content: new Map(), resets: [], reset(id) { this.resets.push(id); },
    layout: { subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, groups: () => groups } };
  return { state: { files: [], dirtyFiles: new Set() }, docking, commands: { configure: (id, value) => commands.set(id, value) },
    compiler: { request: async () => null }, runtime: { request: async () => null },
    toast: message => errors.push(message), renderPanel() {}, explorerContext: () => ({ records: [] }),
    test: { commands, errors, listeners, show(id, node = element()) {
      docking.content.set(id, node); groups = [{ active: id }];
      for (const listener of listeners) listener();
      return node;
    }, refresh() { for (const listener of listeners) listener(); } } };
}

export function controllerModules() {
  const loaded = [], created = [], rendered = [], calls = [];
  function controller(id) {
    return class {
      constructor(options) {
        this.options = options;
        this.settings = options.settings;
        this.buffers = options.buffers;
        this.sourceSync = { sourceChanged: uri => calls.push(['changed', uri]) };
        this.document = { select: ids => ids };
        created.push(id);
      }
      ensure() { calls.push(['ensure']); }
      snapshot() { return { ready: true }; }
      open(...args) { calls.push(['open', ...args]); return 'opened'; }
      autoConnect() { calls.push(['autoConnect']); return true; }
      render(...args) { rendered.push([id, ...args]); }
      renderTool(...args) { rendered.push([id, ...args]); }
      openProject() { return 'project'; }
      openItem() { return 'item'; }
      selectImport() { return 'import'; }
      dispose() { calls.push(['dispose', id]); }
    };
  }
  const loaders = Object.fromEntries([
    ['designer', 'DesignerTools'], ['assembly', 'AssemblyWorkbench'], ['disassembly', 'DisassemblyTool'],
    ['msbuild', 'MSBuildTools'], ['wizard', 'ProjectWizard']
  ].map(([id, name]) => [id, async () => { loaded.push(id); return { [name]: controller(id) }; }]));
  return { loaders, loaded, created, rendered, calls };
}
