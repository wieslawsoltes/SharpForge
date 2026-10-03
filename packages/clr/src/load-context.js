import { AssemblyResolver } from './resolver.js';
import { asAssemblyName } from './assembly-name.js';
import { compareAssemblyIdentity } from './identity.js';
import { RuntimeAssembly } from './assembly.js';
import { AssemblyDependencyGraph } from './dependency-graph.js';
import { ContextRoots } from './unload.js';
import { ContextEvents } from './context-events.js';
import { TypeLoader } from './type-system/type-loader.js';
import { checkCancellation, loadError, LoadErrorCode } from './load-errors.js';

/** Explicit runtime session: Default context and a weak registry of collectible custom contexts. */
export class AssemblyLoadSession {
  #contexts = new Set();
  #registered = new WeakSet();
  #events = new ContextEvents();
  #maxContexts;
  constructor(options = {}) {
    this.#maxContexts = options.maxContexts ?? 1024;
    if (!Number.isSafeInteger(this.#maxContexts) || this.#maxContexts < 1) throw new RangeError('Invalid load context limit');
    this.defaultContext = new AssemblyLoadContext(this, { ...options, name: 'Default', isCollectible: false });
  }

  createContext(options = {}) {
    return new AssemblyLoadContext(this, options);
  }

  registerContext(context) {
    if (!(context instanceof AssemblyLoadContext) || context.session !== this) throw new TypeError('Context belongs to another session');
    if (this.#registered.has(context)) return;
    if (this.#contexts.size >= this.#maxContexts && this.contexts.length >= this.#maxContexts) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Session load context limit exceeded');
    }
    this.#registered.add(context);
    this.#contexts.add(context.isCollectible ? new WeakRef(context) : context);
  }

  get contexts() {
    const result = [];
    for (const entry of this.#contexts) {
      const context = entry instanceof WeakRef ? entry.deref() : entry;
      if (!context || context.isUnloading) this.#contexts.delete(entry);
      else result.push(context);
    }
    return Object.freeze(result);
  }

  getAssemblies() { return Object.freeze(this.contexts.flatMap(context => context.assemblies)); }
  onAssemblyLoad(listener) { return this.#events.on('assemblyLoad', listener); }
  onAssemblyResolve(listener) { return this.#events.on('assemblyResolve', listener); }
  onTypeResolve(listener) { return this.#events.on('typeResolve', listener); }
  assemblyLoaded(assembly) { this.#events.emit('assemblyLoad', assembly); }
  resolveAssembly(request) { return this.#events.resolve('assemblyResolve', request); }
  resolveType(request) { return this.#events.resolve('typeResolve', request); }
}

/** CLR-style name isolation, lazy references and explicit host-controlled loading. */
export class AssemblyLoadContext {
  #session;
  #resolver;
  #load;
  #events = new ContextEvents();
  #assemblies = new Map();
  #bindings = new Map();
  #pending = new Map();
  #callbacks = new Set();
  #unloading = false;
  #loadOrder = [];
  #maxAssemblies;
  #types;
  #typeOptions;
  constructor(session, {
    name = '', isCollectible = false, resolver = new AssemblyResolver(), load = null, maxAssemblies = 10000, typeOptions = {},
  } = {}) {
    if (!(session instanceof AssemblyLoadSession) || !(resolver instanceof AssemblyResolver)) throw new TypeError('Session and resolver required');
    if (load !== null && typeof load !== 'function') throw new TypeError('Load override must be callable');
    if (!Number.isSafeInteger(maxAssemblies) || maxAssemblies < 1) throw new RangeError('Invalid context assembly limit');
    this.#session = session;
    this.#resolver = resolver;
    this.#load = load;
    this.#maxAssemblies = maxAssemblies;
    this.#typeOptions = { ...typeOptions };
    this.name = String(name);
    this.isCollectible = Boolean(isCollectible);
    this.roots = new ContextRoots(this);
    this.dependencies = new AssemblyDependencyGraph(this);
    Object.freeze(this);
    session.registerContext(this);
  }

  get isUnloading() { return this.#unloading; }
  get assemblies() { return Object.freeze([...this.#assemblies.values()]); }
  get loadOrder() { return Object.freeze([...this.#loadOrder]); }
  get session() { return this.#session; }
  /** Lazy, context-owned graph loading over canonical module definitions. */
  get types() { return this.#types ??= new TypeLoader(this, this.#typeOptions); }
  ensureUsable() { /* Existing assemblies remain usable while outstanding roots delay collection. */ }

  ensureActive() {
    if (this.#unloading) throw loadError(LoadErrorCode.Disposed, `Load context ${this.name} is unloading`);
  }

  onResolving(listener) { this.ensureActive(); return this.#events.on('resolving', listener); }
  onUnloading(listener) { this.ensureActive(); return this.#events.on('unloading', listener); }

  /** Parse a host-provided image without resolving any AssemblyRef or decoding method bodies. */
  async loadFromStream(bytes, options = {}) {
    this.ensureActive();
    checkCancellation(options.signal);
    const assembly = await RuntimeAssembly.fromBytes(this, bytes, options);
    return this.#acceptAssembly(assembly, options);
  }

  #acceptAssembly(assembly, options) {
    this.ensureActive();
    const key = assembly.identity.name.toLowerCase();
    const existing = this.#bindings.get(key);
    if (existing) {
      this.#checkIdentity(assembly.identity, existing, options, 'exact');
      return existing;
    }
    if (this.#bindings.size === this.#maxAssemblies) throw loadError(LoadErrorCode.LimitExceeded, 'Context assembly limit exceeded');
    this.#assemblies.set(key, assembly);
    this.#bindings.set(key, assembly);
    this.#loadOrder.push(assembly.fullName);
    this.#session.assemblyLoaded(assembly);
    return assembly;
  }

  #checkIdentity(reference, assembly, options, versionPolicy = 'higher') {
    const comparison = compareAssemblyIdentity(reference, assembly.identity, { versionPolicy });
    if (!comparison.matches) {
      throw loadError(LoadErrorCode.IdentityMismatch, `Loaded assembly does not match: ${comparison.mismatches.join(', ')}`, {
        requested: reference.fullName, requester: options.requester?.fullName ?? null,
      });
    }
    return assembly;
  }

  /** Resolve on first use. A context binds at most one version of each simple assembly name. */
  async loadFromAssemblyName(value, options = {}) {
    return this.#loadWithPath(value, options, []);
  }

  async #loadWithPath(value, options, path) {
    this.ensureActive();
    checkCancellation(options.signal);
    const reference = asAssemblyName(value);
    const key = reference.name.toLowerCase();
    const existing = this.#bindings.get(key);
    if (existing) return this.#checkIdentity(reference, existing, options);
    if (this.#callbacks.has(key) || path.includes(key)) {
      throw loadError(LoadErrorCode.RecursiveResolution, `Reentrant resolution of ${reference.name}`);
    }
    if (!this.#pending.has(key)) {
      if (this.#pending.size >= this.#maxAssemblies) throw loadError(LoadErrorCode.LimitExceeded, 'Pending assembly load limit exceeded');
      // Publish before invoking host code so independent asynchronous callers share this operation.
      const pending = Promise.resolve().then(() => this.#resolve(reference, options, [...path, key]));
      this.#pending.set(key, pending);
    }
    const pending = this.#pending.get(key);
    try {
      const assembly = await pending;
      this.ensureActive();
      checkCancellation(options.signal);
      return this.#checkIdentity(reference, assembly, options);
    } finally {
      if (this.#pending.get(key) === pending) this.#pending.delete(key);
    }
  }

  async #resolve(reference, options, path) {
    const request = Object.freeze({
      context: this, assemblyName: reference, requester: options.requester ?? null, signal: options.signal,
      resolveAssembly: (name, nestedOptions = {}) => this.#loadWithPath(name, { ...options, ...nestedOptions }, path),
    });
    const key = reference.name.toLowerCase();
    let result = this.#load ? await this.#invokeCallback(key, () => this.#load(request)) : null;
    this.ensureActive();
    if (result === null || result === undefined) {
      try { result = this.#resolver.resolve(reference, options); }
      catch (error) {
        if (error.code !== LoadErrorCode.MissingAssembly) throw error;
        result = await this.#invokeCallback(key, () => this.#events.resolve('resolving', request));
        if (result === null) result = await this.#invokeCallback(key, () => this.#session.resolveAssembly(request));
        if (result === null) throw error;
      }
    }
    this.ensureActive();
    checkCancellation(options.signal);
    if (result instanceof RuntimeAssembly) {
      this.#checkIdentity(reference, result, options);
      if (this.#bindings.size === this.#maxAssemblies) throw loadError(LoadErrorCode.LimitExceeded, 'Context assembly limit exceeded');
      this.#bindings.set(key, result);
      return result;
    }
    const bytes = result instanceof Uint8Array || result instanceof ArrayBuffer ? result : result?.bytes;
    if (!bytes) throw loadError(LoadErrorCode.InvalidImage, 'Assembly resolver must return bytes or an existing RuntimeAssembly');
    const assembly = await RuntimeAssembly.fromBytes(this, bytes, options);
    this.#checkIdentity(reference, assembly, options);
    return this.#acceptAssembly(assembly, options);
  }

  #invokeCallback(key, callback) {
    this.#callbacks.add(key);
    try { return callback(); }
    finally { this.#callbacks.delete(key); }
  }

  /** Begin cooperative unloading; existing type/instance roots keep their assembly and context alive. */
  unload() {
    if (!this.isCollectible) throw loadError(LoadErrorCode.InvalidConfiguration, 'Default or noncollectible context cannot unload');
    if (this.#unloading) return;
    this.#unloading = true;
    try { this.#events.emit('unloading', this); }
    finally {
      this.#events.clear();
      this.#resolver = null;
      this.#load = null;
    }
  }
}
