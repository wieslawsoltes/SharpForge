const MAX_STORAGE = 2 * 1024 * 1024;

export function validateWatchState(value) {
  if (!value || !Array.isArray(value.expressions) || value.expressions.length > 128
      || typeof value.target !== 'string' || !/^(?:active|session:[^\u0000-\u001f]{1,128})$/u.test(value.target)) {
    throw new TypeError('Invalid Watch window settings');
  }
  const expressions = value.expressions.map(expression => {
    if (typeof expression !== 'string' || !expression.trim() || expression.length > 4096) {
      throw new TypeError('Watch expressions must contain 1–4096 characters');
    }
    return expression.trim();
  });
  if (new Set(expressions).size !== expressions.length) throw new TypeError('Duplicate Watch expression');
  return { expressions, target: value.target };
}

/** Persist expressions and the selected application, never evaluated values or runtime capabilities. */
export class WatchWindowState {
  constructor({ storage, key = 'sharpforge.watch-windows.v1', onError = () => {} } = {}) {
    this.storage = storage;
    this.key = key;
    this.entries = {};
    try {
      const text = storage?.getItem(key);
      if (!text) return;
      if (text.length > MAX_STORAGE) throw new RangeError('Watch settings exceed the storage limit');
      const value = JSON.parse(text);
      if (value.version !== 1 || !value.windows || typeof value.windows !== 'object'
          || Array.isArray(value.windows) || Object.keys(value.windows).length > 256) {
        throw new TypeError('Unsupported Watch settings');
      }
      const entries = {};
      for (const [id, state] of Object.entries(value.windows)) {
        this.validateId(id);
        entries[id] = validateWatchState(state);
      }
      this.entries = entries;
    } catch (error) { onError(error); }
  }

  validateId(id) {
    if (typeof id !== 'string' || id.length > 512 || !/^tool:watch:[1-4](?::.+)?$/u.test(id)) {
      throw new TypeError('Invalid Watch window identity');
    }
  }

  get(id) {
    const entry = this.entries[id];
    return entry ? { ...entry, expressions: [...entry.expressions] } : null;
  }

  set(id, state) {
    this.validateId(id);
    const next = { ...this.entries, [id]: validateWatchState(state) };
    if (Object.keys(next).length > 256) throw new RangeError('Too many stored Watch windows');
    const text = JSON.stringify({ version: 1, windows: next });
    if (text.length > MAX_STORAGE) throw new RangeError('Watch settings exceed the storage limit');
    this.storage?.setItem(this.key, text);
    this.entries = next;
  }
}
