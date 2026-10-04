import {CommandRegistry} from '@sharpforge/controls';

/** Shared registry facade; onExecute(id, invocation) observes an enabled, non-aborted user action before its handler runs. */
export function createCommandRegistry({context = () => ({}), onExecute = () => {}} = {}) {
  const registry = new CommandRegistry();
  const listeners = new Set();
  let disposed = false;
  let contextProvider = context;
  const assertOpen = () => {
    if (disposed) throw new Error('Command registry is disposed');
  };
  const changed = () => {
    for (const listener of listeners) listener();
  };
  const api = {
    registry,
    setContext(provider) {
      if (typeof provider !== 'function') throw new TypeError('Context provider must be a function');
      contextProvider = provider;
      changed();
    },
    registerCommand(id, title, shortcut, handler, options = {}) {
      assertOpen();
      if (typeof title !== 'string' || typeof shortcut !== 'string' || typeof handler !== 'function') {
        throw new TypeError('Malformed command');
      }
      const remove = registry.register({
        id, label: title, title, shortcut,
        category: options.category ?? title.split(':')[0],
        visible: options.visible !== false,
        enabled: options.enabled ?? true,
        checked: options.checked,
        execute: invocation => {
          invocation.signal?.throwIfAborted();
          return handler(id, ...(invocation.args ?? []));
        }
      });
      changed();
      return () => { remove(); changed(); };
    },
    register(command) {
      assertOpen();
      const remove = registry.register({...command, label: command.label ?? command.title, visible: command.visible !== false});
      changed();
      return () => { remove(); changed(); };
    },
    describe(id, overrides = {}) {
      return registry.describe(id, {...contextProvider(), ...overrides});
    },
    configure(id, changes) {
      assertOpen();
      const current = registry.commands.get(id);
      if (!current) throw new Error('Unknown command ' + id);
      const permitted = ['enabled', 'checked', 'shortcut', 'category', 'label', 'title', 'execute'];
      for (const key of Object.keys(changes)) {
        if (!permitted.includes(key)) throw new TypeError('Invalid command property ' + key);
      }
      registry.commands.set(id, {...current, ...changes});
      changed();
      return () => { registry.commands.set(id, current); changed(); };
    },
    async execute(id, ...args) {
      assertOpen();
      const invocation = {...contextProvider(), args};
      if (registry.describe(id, invocation)?.enabled) onExecute(id, invocation);
      return registry.execute(id, invocation);
    },
    async invoke(id, invocation = {}) {
      assertOpen();
      invocation.signal?.throwIfAborted();
      const current = {...contextProvider(), ...invocation};
      if (registry.describe(id, current)?.enabled) onExecute(id, current);
      return registry.execute(id, current);
    },
    search(query = '', overrides = {}) {
      return registry.search(query, {...contextProvider(), ...overrides}).filter(command => command.visible !== false);
    },
    list() {
      return api.search().map(({id, label, shortcut}) => [id, label, shortcut ?? '']);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidate: changed,
    dispose() {
      if (disposed) return;
      disposed = true;
      registry.commands.clear();
      listeners.clear();
    }
  };
  return api;
}
