import { TypeDesc } from '../type-system/type-desc.js';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

/** Snapshot a caller's ordered handles before an asynchronous binding can observe array mutation. */
export function copyTypeArguments(arguments_, label = 'Generic') {
  if (!Array.isArray(arguments_)) {
    throw loadError(LoadErrorCode.TypeLoad, `${label} arguments require an array of at most 1024 TypeDesc handles`);
  }
  const length = arguments_.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > 1024) {
    throw loadError(LoadErrorCode.TypeLoad, `${label} arguments require an array of at most 1024 TypeDesc handles`);
  }
  const copy = new Array(length);
  for (let index = 0; index < length; index++) {
    const type = arguments_[index];
    if (!(type instanceof TypeDesc)) {
      throw loadError(LoadErrorCode.TypeLoad, `${label} argument is not a TypeDesc handle`);
    }
    copy[index] = type;
  }
  return Object.freeze(copy);
}

export function copyResolutionContext(options) {
  const { typeArguments, methodArguments } = options;
  if (typeArguments === undefined && methodArguments === undefined) return null;
  return Object.freeze({
    typeArguments: typeArguments === undefined ? undefined : copyTypeArguments(typeArguments, 'Type'),
    methodArguments: methodArguments === undefined ? undefined : copyTypeArguments(methodArguments, 'Method'),
  });
}

/** Per-operation work and scope identities; no resolved descriptor is retained by a loader-wide scope cache. */
export class GenericResolutionContext {
  #remaining;
  #signal;
  #identities = new WeakMap();
  #sequence = 0;
  #markers = new WeakMap();
  #contexts = new WeakSet();
  #observed = new WeakSet();
  #watch;
  #monitors = [];
  #unloaded = false;
  #disposed = false;

  constructor(maxWork, signal, watch) {
    this.#remaining = maxWork;
    this.#signal = signal;
    this.#watch = watch;
  }

  visit(count = 1) {
    checkCancellation(this.#signal);
    if (this.#disposed) throw loadError(LoadErrorCode.Disposed, 'Generic resolution operation has ended');
    if (this.#unloaded) throw loadError(LoadErrorCode.Disposed, 'A generic type context began unloading during resolution');
    this.#remaining -= count;
    if (this.#remaining < 0) throw loadError(LoadErrorCode.LimitExceeded, 'Generic resolution work limit exceeded');
  }

  observeContext(context, wasUnloading = context.isUnloading) {
    if (this.#contexts.has(context)) return;
    this.visit();
    this.#contexts.add(context);
    if (wasUnloading || !context.isCollectible) return;
    if (context.isUnloading) this.invalidate();
    else this.#monitors.push(this.#watch(context, this));
  }

  invalidate() { this.#unloaded = true; }

  complete() {
    this.visit(0);
    // A throwing user event listener can prevent later listeners from being invoked.
    // Poll once at the root publication boundary without scanning on every graph visit.
    for (const monitor of this.#monitors) {
      if (monitor.isUnloading) this.invalidate();
    }
    this.visit(0);
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const monitor of this.#monitors) monitor.release(this);
    this.#monitors.length = 0;
  }

  observe(type) {
    const pending = [type];
    while (pending.length) {
      const current = pending.pop();
      this.visit();
      if (this.#observed.has(current)) continue;
      this.#observed.add(current);
      this.observeContext(current.loadContext);
      if (current.elementType) pending.push(current.elementType);
      if (current.genericDefinition) pending.push(current.genericDefinition, ...current.genericArguments);
      if (current.signature) pending.push(current.signature.returnType, ...current.signature.parameters);
    }
  }

  #argumentKey(arguments_) {
    if (arguments_ === undefined) return '-';
    this.visit(arguments_.length);
    const parts = [];
    for (const type of arguments_) {
      let identity = this.#identities.get(type);
      if (identity === undefined) {
        identity = ++this.#sequence;
        this.#identities.set(type, identity);
      }
      parts.push(identity);
    }
    return parts.join(',');
  }

  marker(specification, scope) {
    if (scope === null) return specification;
    const key = `${this.#argumentKey(scope.typeArguments)}|${this.#argumentKey(scope.methodArguments)}`;
    let markers = this.#markers.get(specification);
    if (!markers) {
      markers = new Map();
      this.#markers.set(specification, markers);
    }
    let marker = markers.get(key);
    if (!marker) {
      this.visit();
      marker = Object.freeze({ specification, key });
      markers.set(key, marker);
    }
    return marker;
  }
}
