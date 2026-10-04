import {ResourceDictionary} from './resource-dictionary.js';
import {ResourceReference} from './reference.js';
import {ResourceFault} from './errors.js';

/** An element resource scope, with explicit parent/theme lifetimes and key-specific observers. */
export class ResourceScope {
  constructor({resources = new ResourceDictionary(), parent = null, application = null, theme = 'Default', owner = null} = {}) {
    if (!(resources instanceof ResourceDictionary)) throw new TypeError('Resources must be a ResourceDictionary.');
    if (!['Default', 'Light', 'Dark', 'HighContrast'].includes(theme)) throw new ResourceFault('SFRES007', 'Invalid element theme.');
    this.resources = resources;
    this.parent = null;
    this.application = application;
    this.requestedTheme = theme;
    this.systemTheme = 'Light';
    this.highContrast = false;
    this.owner = owner;
    this.children = new Set();
    this.observers = new Set();
    this.themeListeners = new Set();
    this.disposed = false;
    if (!parent) application?.children.add(this);
    this.setParent(parent);
  }

  get actualTheme() {
    let theme = null, current = this;
    const seen = new Set();
    while (current) {
      if (seen.has(current) || seen.size >= 4096) throw new ResourceFault('SFRES014', 'Resource scope ancestry limit exceeded.');
      seen.add(current);
      if (theme === null && current.requestedTheme !== 'Default') theme = current.requestedTheme;
      const parent = current.parent ?? current.application;
      if (!parent) return current.highContrast ? 'HighContrast' : theme ?? current.systemTheme;
      current = parent;
    }
  }

  get root() {
    let scope = this;
    const visited = new Set();
    while (scope.parent ?? scope.application) {
      if (visited.has(scope) || visited.size >= 4096) throw new ResourceFault('SFRES014', 'Resource scope ancestry limit exceeded.');
      visited.add(scope);
      scope = scope.parent ?? scope.application;
    }
    return scope;
  }

  setParent(parent) {
    if (parent === this.parent) return;
    const seen = new Set([this]);
    for (let scope = parent ?? this.application; scope; scope = scope.parent ?? scope.application) {
      if (seen.has(scope) || seen.size >= 4096) throw new ResourceFault('SFRES014', 'Resource scope ancestry limit exceeded.');
      seen.add(scope);
    }
    const previous = this.captureThemes();
    const before = this.parent;
    (before ?? this.application)?.children.delete(this);
    this.parent = parent;
    (parent ?? this.application)?.children.add(this);
    try {
      for (const observer of this.subtreeObservers()) observer.validate();
    } catch (error) {
      (parent ?? this.application)?.children.delete(this);
      this.parent = before;
      (before ?? this.application)?.children.add(this);
      throw error;
    }
    this.invalidate(previous);
  }

  setResources(resources) {
    if (!(resources instanceof ResourceDictionary)) throw new TypeError('Resources must be a ResourceDictionary.');
    const previous = this.resources;
    this.resources = resources;
    try {
      for (const observer of this.subtreeObservers()) observer.validate();
    } catch (error) {
      this.resources = previous;
      throw error;
    }
    this.invalidate();
  }

  setTheme(theme) {
    if (!['Default', 'Light', 'Dark', 'HighContrast'].includes(theme)) throw new ResourceFault('SFRES007', 'Invalid element theme.');
    if (this.requestedTheme === theme) return;
    const previous = this.captureThemes();
    const oldTheme = this.requestedTheme;
    this.requestedTheme = theme;
    try {
      for (const observer of this.subtreeObservers()) observer.validate();
    } catch (error) {
      this.requestedTheme = oldTheme;
      throw error;
    }
    this.invalidate(previous);
  }

  setSystemTheme(theme, highContrast = false) {
    if (!['Light', 'Dark'].includes(theme)) throw new ResourceFault('SFRES007', 'Invalid system theme.');
    const root = this.root;
    const previous = root.captureThemes();
    const before = {systemTheme: root.systemTheme, highContrast: root.highContrast};
    root.systemTheme = theme;
    root.highContrast = Boolean(highContrast);
    try {
      for (const observer of root.subtreeObservers()) observer.validate();
    } catch (error) {
      Object.assign(root, before);
      throw error;
    }
    root.invalidate(previous);
  }

  captureThemes() {
    const result = new Map();
    for (const scope of this.subtree()) result.set(scope, scope.actualTheme);
    return result;
  }

  *subtree() {
    const queue = [this], seen = new Set();
    while (queue.length) {
      const scope = queue.pop();
      if (seen.has(scope) || seen.size >= 100000) throw new ResourceFault('SFRES014', 'Resource scope tree limit exceeded.');
      seen.add(scope);
      yield scope;
      for (const child of scope.children) queue.push(child);
    }
  }

  *subtreeObservers() {
    for (const scope of this.subtree()) yield* scope.observers;
  }

  invalidate(previousThemes = null) {
    for (const scope of this.subtree()) {
      const before = previousThemes?.get(scope);
      if (before !== undefined && before !== scope.actualTheme) {
        for (const listener of [...scope.themeListeners]) listener({scope, oldTheme: before, newTheme: scope.actualTheme});
      }
      for (const observer of [...scope.observers]) observer.update();
    }
  }

  tryFind(key, {dependencies = null, maxEntries = null, theme = this.actualTheme} = {}) {
    const visited = new Set();
    let scope = this;
    while (scope) {
      if (visited.has(scope) || visited.size >= 4096) throw new ResourceFault('SFRES014', 'Resource scope ancestry limit exceeded.');
      visited.add(scope);
      const found = scope.resources.tryGetValue(key, {theme, dependencies, maxEntries});
      if (found.found) return found;
      scope = scope.parent ?? (scope.application !== scope ? scope.application : null);
    }
    return {found: false, value: undefined};
  }

  find(key, options) {
    const result = this.tryFind(key, options);
    if (!result.found) throw new ResourceFault('SFRES013', `Resource '${String(key)}' was not found.`, {key});
    return result.value;
  }

  /** Static references resolve once. Dynamic consumers are rebound only to dictionaries they consulted. */
  observe(reference, {changed, validate = null, allowMissing = false, equals = Object.is} = {}) {
    if (!(reference instanceof ResourceReference)) throw new TypeError('A ResourceReference is required.');
    if (this.disposed) throw new ResourceFault('SFRES015', 'The resource scope is disposed.');
    const resolve = dependencies => {
      const result = this.tryFind(reference.key, {dependencies});
      if (!result.found && !allowMissing) throw new ResourceFault('SFRES013', `Resource '${String(reference.key)}' was not found.`);
      return result.found ? result.value : undefined;
    };
    const relevant = change => change.keys.has(null) || change.keys.has(reference.key);
    const observer = {
      disposed: false,
      value: undefined,
      initialized: false,
      disposers: [],
      dependencies: new Set(),
      validate: () => validate?.(resolve()),
      update: () => {
        if (observer.disposed) return;
        const dependencies = new Set();
        const next = resolve(dependencies);
        validate?.(next);
        observer.dependencies = dependencies;
        observer.rewire();
        const previous = observer.value;
        observer.value = next;
        if (!observer.initialized || !equals(previous, next)) changed?.(next, previous);
        observer.initialized = true;
      },
      rewire: () => {
        for (const dispose of observer.disposers) dispose();
        observer.disposers = [];
        if (!reference.dynamic || observer.disposed) return;
        for (const dictionary of observer.dependencies) observer.disposers.push(dictionary.subscribe({
          validate: change => { if (relevant(change)) observer.validate(); },
          changed: change => { if (relevant(change)) observer.update(); }
        }));
      }
    };
    observer.dispose = () => {
      if (observer.disposed) return;
      observer.disposed = true;
      this.observers.delete(observer);
      for (const dispose of observer.disposers) dispose();
      observer.disposers.length = 0;
      observer.value = undefined;
    };
    observer.dispose.snapshot = () => ({value: observer.value, initialized: observer.initialized,
      disposed: observer.disposed, dependencies: new Set(observer.dependencies)});
    observer.dispose.restore = snapshot => {
      Object.assign(observer, {value: snapshot.value, initialized: snapshot.initialized,
        disposed: snapshot.disposed, dependencies: new Set(snapshot.dependencies)});
      if (reference.dynamic && !observer.disposed) this.observers.add(observer);
      observer.rewire();
    };
    try { observer.update(); } catch (error) { observer.dispose(); throw error; }
    if (reference.dynamic) this.observers.add(observer);
    return observer.dispose;
  }

  onThemeChanged(listener) {
    this.themeListeners.add(listener);
    return () => this.themeListeners.delete(listener);
  }

  snapshot() {
    return {owner: this.owner, resources: this.resources, resourcesState: this.resources.snapshot(), parent: this.parent, application: this.application,
      requestedTheme: this.requestedTheme, systemTheme: this.systemTheme, highContrast: this.highContrast,
      disposed: this.disposed, themeListeners: [...this.themeListeners],
      observers: [...this.observers].map(observer => ({observer, value: observer.value,
        initialized: observer.initialized, disposed: observer.disposed, dependencies: new Set(observer.dependencies)}))};
  }

  /** Reconnect subscriptions from their saved dependencies without resolving deferred resources or notifying consumers. */
  restore(snapshot) {
    const observers = new Set(snapshot.observers.map(entry => entry.observer));
    for (const observer of [...this.observers]) if (!observers.has(observer)) observer.dispose();
    (this.parent ?? this.application)?.children.delete(this);
    for (const name of ['owner', 'resources', 'parent', 'application', 'requestedTheme', 'systemTheme', 'highContrast', 'disposed']) {
      this[name] = snapshot[name];
    }
    this.resources.restore(snapshot.resourcesState);
    (this.parent ?? this.application)?.children.add(this);
    this.themeListeners = new Set(snapshot.themeListeners);
    this.observers = observers;
    for (const entry of snapshot.observers) {
      Object.assign(entry.observer, {value: entry.value, initialized: entry.initialized,
        disposed: entry.disposed, dependencies: new Set(entry.dependencies)});
      entry.observer.rewire();
    }
  }

  *retainedValues() {
    yield this.owner;
    yield* this.resources.retainedValues();
    for (const observer of this.observers) yield observer.value;
  }

  dispose() {
    if (this.disposed) return;
    const scopes = [...this.subtree()];
    for (let index = scopes.length - 1; index >= 0; index--) {
      const scope = scopes[index];
      scope.disposed = true;
      for (const observer of [...scope.observers]) observer.dispose();
      scope.observers.clear();
      scope.themeListeners.clear();
      (scope.parent ?? scope.application)?.children.delete(scope);
      scope.children.clear();
      scope.parent = null;
      scope.application = null;
      scope.owner = null;
    }
  }
}
