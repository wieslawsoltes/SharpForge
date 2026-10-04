/** Existing v1 payloads remain readable; failures never masquerade as persisted data. */
export const storageKeys = Object.freeze({
  workspace: 'sharpforge.workspace.v1',
  designer: 'sharpforge.designer.settings.v1',
  editor: 'sharpforge.editor.settings.v1',
  layouts: 'sharpforge.named-layouts.v1',
  previous: 'sharpforge.previous.v1',
  debugger: 'sharpforge.debugger.settings.v1',
  docking: 'sharpforge.docking.v1',
  recent: 'sharpforge.templates.recent',
  explorer: 'sharpforge.explorer.'
});

export class StorageFailure extends Error {
  constructor(operation, key, cause) {
    super(`Could not ${operation} ${key}: ${cause?.message ?? cause}`, {cause});
    this.name = 'StorageFailure';
    this.code = cause?.name === 'QuotaExceededError' ? 'quota' : 'unavailable';
    this.key = key;
  }
}

export function createStorage({provider = () => globalThis.localStorage, onError = () => {}} = {}) {
  const valid = key => {
    if (typeof key !== 'string' || !Object.values(storageKeys).includes(key) && !key.startsWith(storageKeys.explorer)) {
      throw new TypeError('Unregistered storage key ' + key);
    }
  };
  function operation(method, key, value) {
    valid(key);
    try {
      const backend = provider();
      if (!backend) throw new Error('Persistent storage unavailable');
      return backend[method](key, value);
    } catch (cause) {
      const error = new StorageFailure(method === 'getItem' ? 'read' : 'write', key, cause);
      onError(error);
      throw error;
    }
  }
  return {
    getItem: key => operation('getItem', key),
    setItem: (key, value) => operation('setItem', key, String(value)),
    removeItem: key => operation('removeItem', key),
    get(key, {version = 1, fallback = null} = {}) {
      try {
        const raw = operation('getItem', key);
        if (raw === null) return fallback;
        const data = JSON.parse(raw);
        if (data && Object.hasOwn(data, '$storageVersion')) return data.$storageVersion === version ? data.value : fallback;
        return version === 1 ? data : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value, {version = 1} = {}) {
      if (!Number.isSafeInteger(version) || version < 1) throw new TypeError('Invalid storage version');
      try {
        operation('setItem', key, JSON.stringify({$storageVersion: version, value}));
        return {ok: true};
      } catch (error) {
        return {ok: false, error};
      }
    }
  };
}

export const storage = createStorage();
