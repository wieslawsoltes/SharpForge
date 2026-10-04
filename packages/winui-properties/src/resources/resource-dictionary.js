import {DeferredResource} from './reference.js';
import {ResourceFault} from './errors.js';

/** Keyed resources with local-first, reverse-merge lookup and atomic observable mutation. */
export class ResourceDictionary {
  constructor(entries = [], {maxDictionaries = 4096, maxDepth = 256, maxEntries = 100000} = {}) {
    this.values = new Map(entries);
    this.merged = [];
    this.themes = new Map();
    this.maxDictionaries = maxDictionaries;
    this.maxDepth = maxDepth;
    this.maxEntries = maxEntries;
    this.listeners = new Set();
    this.revision = 0;
    this.disposed = false;
    this.mutating = false;
    this.transactionDepth = 0;
    this.pendingKeys = new Set();
    this.validateEntries();
  }

  get count() { return this.values.size; }
  get Count() { return this.count; }
  get mergedDictionaries() { return Object.freeze([...this.merged]); }
  get themeDictionaries() { return new Map(this.themes); }
  [Symbol.iterator]() { return this.values[Symbol.iterator](); }
  keys() { return this.values.keys(); }
  hasLocal(key) { return this.values.has(key); }

  validateEntries() {
    if (this.values.size > this.maxEntries) throw new ResourceFault('SFRES005', 'Resource entry limit exceeded.');
    for (const key of this.values.keys()) this.validateKey(key);
  }

  validateKey(key) {
    if (key === null || key === undefined) throw new ResourceFault('SFRES001', 'A resource key is required.');
  }

  add(key, value) {
    this.validateKey(key);
    if (this.values.has(key)) throw new ResourceFault('SFRES006', `Duplicate resource key '${String(key)}'.`);
    this.set(key, value);
  }

  set(key, value) {
    this.validateKey(key);
    if (this.values.has(key) && Object.is(this.values.get(key), value)) return;
    this.mutate(() => this.values.set(key, value), key);
  }

  remove(key) {
    if (!this.values.has(key)) return false;
    this.mutate(() => this.values.delete(key), key);
    return true;
  }

  clear() {
    if (this.values.size) this.mutate(() => this.values.clear());
  }

  setMerged(dictionaries) {
    const next = Array.from(dictionaries);
    if (next.some(value => !(value instanceof ResourceDictionary))) throw new TypeError('Merged resources require dictionaries.');
    this.mutate(() => { this.merged = next; });
  }

  addMerged(dictionary) { this.setMerged([...this.merged, dictionary]); }
  removeMerged(dictionary) { this.setMerged(this.merged.filter(value => value !== dictionary)); }

  setTheme(theme, dictionary) {
    if (!['Default', 'Light', 'Dark', 'HighContrast'].includes(theme)) {
      throw new ResourceFault('SFRES007', `Unknown resource theme '${theme}'.`);
    }
    if (!(dictionary instanceof ResourceDictionary)) throw new TypeError('A theme resource dictionary is required.');
    this.mutate(() => this.themes.set(theme, dictionary));
  }

  removeTheme(theme) {
    if (this.themes.has(theme)) this.mutate(() => this.themes.delete(theme));
  }

  captureLocal() {
    return {values: new Map(this.values), merged: [...this.merged], themes: new Map(this.themes)};
  }

  restore(snapshot) {
    if (snapshot.version === 1) {
      for (let index = 0; index < snapshot.dictionaries.length; index++) {
        const entry = snapshot.dictionaries[index];
        const dictionary = index === 0 ? this : entry.dictionary;
        dictionary.values = new Map(entry.state.values);
        dictionary.merged = [...entry.state.merged];
        dictionary.themes = new Map(entry.state.themes);
        dictionary.disposed = entry.disposed;
        dictionary.revision = entry.revision;
        dictionary.listeners = new Set(entry.listeners);
        for (const [resource, state] of entry.deferred) resource.restore(state);
      }
      return;
    }
    this.values = snapshot.values;
    this.merged = snapshot.merged;
    this.themes = snapshot.themes;
  }

  snapshot() {
    const dictionaries = [];
    const seen = new Set();
    const queue = [this];
    for (let index = 0; index < queue.length; index++) {
      const dictionary = queue[index];
      if (seen.has(dictionary)) continue;
      seen.add(dictionary);
      if (seen.size > this.maxDictionaries) throw new ResourceFault('SFRES012', 'Resource snapshot graph budget exceeded.');
      dictionaries.push({dictionary, state: dictionary.captureLocal(), disposed: dictionary.disposed,
        revision: dictionary.revision, listeners: [...dictionary.listeners],
        deferred: [...dictionary.values.values()].filter(value => value instanceof DeferredResource).map(value => [value, value.snapshot()])});
      queue.push(...dictionary.merged, ...dictionary.themes.values());
    }
    return {version: 1, dictionaries};
  }

  /** Validators inspect the candidate state. No changed observer runs until every validator succeeds. */
  transaction(action) {
    if (this.disposed) throw new ResourceFault('SFRES008', 'The resource dictionary is disposed.');
    if (this.mutating) throw new ResourceFault('SFRES009', 'Resource mutation during resource notification is forbidden.');
    if (this.transactionDepth) return action(this);
    const previous = this.captureLocal();
    this.transactionDepth = 1;
    this.pendingKeys.clear();
    let result;
    let committed = false;
    try {
      result = action(this);
      if (result?.then) throw new ResourceFault('SFRES010', 'Resource transactions must be synchronous.');
      this.validateEntries();
      this.validateGraph();
      this.mutating = true;
      const change = {dictionary: this, keys: new Set(this.pendingKeys), revision: this.revision + 1};
      for (const observer of [...this.listeners]) observer.validate?.(change);
      this.revision++;
      committed = true;
      for (const observer of [...this.listeners]) observer.changed?.(change);
    } catch (error) {
      if (!committed) this.restore(previous);
      throw error;
    } finally {
      this.transactionDepth = 0;
      this.mutating = false;
      this.pendingKeys.clear();
    }
    return result;
  }

  mutate(action, key = null) {
    if (this.mutating) throw new ResourceFault('SFRES009', 'Resource mutation during resource notification is forbidden.');
    if (!this.transactionDepth) return this.transaction(() => this.mutate(action, key));
    this.pendingKeys.add(key);
    return action();
  }

  validateGraph() {
    const visited = new Set();
    const active = new Set();
    const visit = (dictionary, depth) => {
      if (active.has(dictionary)) throw new ResourceFault('SFRES011', 'Cyclic merged or theme resource dictionaries.');
      if (visited.has(dictionary)) return;
      if (dictionary.disposed) throw new ResourceFault('SFRES008', 'A referenced resource dictionary is disposed.');
      if (depth > this.maxDepth || visited.size >= this.maxDictionaries) {
        throw new ResourceFault('SFRES012', 'Resource graph traversal limit exceeded.');
      }
      visited.add(dictionary);
      active.add(dictionary);
      for (const child of dictionary.merged) visit(child, depth + 1);
      for (const child of dictionary.themes.values()) visit(child, depth + 1);
      active.delete(dictionary);
    };
    visit(this, 0);
  }

  tryGetValue(key, {theme = 'Light', dependencies = null, maxEntries = null} = {}) {
    if (this.disposed) throw new ResourceFault('SFRES008', 'The resource dictionary is disposed.');
    const visited = new Set();
    const active = new Set();
    const visit = (dictionary, depth) => {
      if (active.has(dictionary)) throw new ResourceFault('SFRES011', 'Cyclic resource dictionary lookup.');
      if (visited.has(dictionary)) return {found: false, value: undefined};
      if (depth > this.maxDepth || visited.size >= this.maxDictionaries) {
        throw new ResourceFault('SFRES012', 'Resource lookup traversal limit exceeded.');
      }
      visited.add(dictionary);
      active.add(dictionary);
      dependencies?.add(dictionary);
      if (dictionary.values.has(key) && (maxEntries === null || this.visibleBefore(dictionary, key, maxEntries))) {
        const candidate = dictionary.values.get(key);
        const value = candidate instanceof DeferredResource ? candidate.get({dictionary, key, theme}) : candidate;
        return {found: true, value, dictionary};
      }
      const themed = dictionary.themes.get(theme) ?? dictionary.themes.get('Default');
      if (themed) {
        const result = visit(themed, depth + 1);
        if (result.found) return result;
      }
      for (let index = dictionary.merged.length - 1; index >= 0; index--) {
        const result = visit(dictionary.merged[index], depth + 1);
        if (result.found) return result;
      }
      active.delete(dictionary);
      return {found: false, value: undefined};
    };
    return visit(this, 0);
  }

  visibleBefore(dictionary, key, maximum) {
    const limit = maximum instanceof Map ? maximum.get(dictionary) : dictionary === this ? maximum : undefined;
    if (limit === undefined) return true;
    let index = 0;
    for (const current of dictionary.values.keys()) {
      if (index++ >= limit) return false;
      if (Object.is(current, key)) return true;
    }
    return false;
  }

  get(key, options) {
    const result = this.tryGetValue(key, options);
    if (!result.found) throw new ResourceFault('SFRES013', `Resource '${String(key)}' was not found.`, {key});
    return result.value;
  }

  containsKey(key, options) { return this.tryGetValue(key, options).found; }

  *retainedValues() {
    const seen = new Set();
    const queue = [this];
    while (queue.length) {
      const dictionary = queue.pop();
      if (seen.has(dictionary)) continue;
      seen.add(dictionary);
      for (const [key, value] of dictionary.values) {
        yield key;
        if (value instanceof DeferredResource) yield* value.retainedValues();
        else yield value;
      }
      queue.push(...dictionary.merged, ...dictionary.themes.values());
    }
  }

  subscribe(observer) {
    if (this.disposed) throw new ResourceFault('SFRES008', 'The resource dictionary is disposed.');
    if (typeof observer === 'function') observer = {changed: observer};
    this.listeners.add(observer);
    return () => this.listeners.delete(observer);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    for (const value of this.values.values()) if (value instanceof DeferredResource) value.dispose();
    this.values.clear();
    this.themes.clear();
    this.merged.length = 0;
  }
}
