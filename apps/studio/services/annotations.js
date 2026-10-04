const empty = Object.freeze([]);

/** Owned diagnostic contributions compose with language diagnostics and dispose without replacing another source. */
export function createEditorAnnotations() {
  const sources = new Map();
  const cache = new Map();
  const listeners = new Set();
  let closed = false;
  const changed = uri => {
    cache.delete(uri);
    for (const listener of listeners) listener(uri);
  };
  return {
    set(source, uri, diagnostics) {
      if (closed) throw new Error('Editor annotations are disposed');
      if (typeof source !== 'string' || !source || source.length > 256 || typeof uri !== 'string' || !uri || uri.length > 4096) {
        throw new TypeError('An annotation source and exact document URI are required');
      }
      if (!Array.isArray(diagnostics) || diagnostics.length > 10000
        || diagnostics.some(item => !item || typeof item !== 'object' || typeof item.message !== 'string')) {
        throw new TypeError('Editor annotations require a bounded diagnostic array');
      }
      if (!sources.has(source)) {
        if (sources.size >= 64) throw new Error('Editor annotation source limit exceeded');
        sources.set(source, new Map());
      }
      const files = sources.get(source);
      if (!files.has(uri) && files.size >= 1000) throw new Error('Editor annotation document limit exceeded');
      files.set(uri, Object.freeze(diagnostics.map(item => Object.freeze({ ...item, source, uri }))));
      changed(uri);
    },
    clear(source, uri) {
      if (closed) return;
      const files = sources.get(source);
      if (!files) return;
      const affected = uri === undefined ? [...files.keys()] : files.has(uri) ? [uri] : [];
      if (uri === undefined) sources.delete(source);
      else {
        files.delete(uri);
        if (!files.size) sources.delete(source);
      }
      for (const path of affected) changed(path);
    },
    get(uri) {
      if (closed) return empty;
      if (!cache.has(uri)) cache.set(uri, Object.freeze([...sources.values()].flatMap(files => files.get(uri) ?? empty)));
      return cache.get(uri);
    },
    reset() {
      if (closed) return;
      const affected = new Set([...sources.values()].flatMap(files => [...files.keys()]));
      sources.clear();
      cache.clear();
      for (const uri of affected) changed(uri);
    },
    subscribe(listener) {
      if (closed) throw new Error('Editor annotations are disposed');
      if (typeof listener !== 'function') throw new TypeError('Annotation listener is required');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() { closed = true; sources.clear(); cache.clear(); listeners.clear(); }
  };
}
