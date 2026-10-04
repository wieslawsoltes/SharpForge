const unhandled = Object.freeze({handled: false});
const memberKinds = new Set([
  'constructor', 'method', 'get', 'set', 'eventAdd', 'eventRemove', 'attachedGet', 'attachedSet'
]);

function memberKey(kind, name, arity) {
  return `${kind}:${name}:${arity}`;
}

/** Application-owned managed/JavaScript member adapters; no implicit host fallthrough. */
export class UIExtensionRegistry {
  constructor({canonicalType = value => value, baseType = () => null, maxDepth = 256} = {}) {
    if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 1024) {
      throw new RangeError('UI adapter inheritance depth must be between 1 and 1024');
    }
    this.canonicalType = canonicalType;
    this.baseType = baseType;
    this.maxDepth = maxDepth;
    this.owners = new Map();
  }

  /** Register one exact member or an arity-independent family, rejecting duplicates. */
  register({owner, kind = 'method', name, arity = '*'}, handler) {
    owner = this.canonicalType(owner);
    if (typeof owner !== 'string' || !owner || typeof name !== 'string' || !name || !memberKinds.has(kind)) {
      throw new TypeError('A UI adapter requires a canonical owner, member kind and name');
    }
    if (arity !== '*' && (!Number.isInteger(arity) || arity < 0 || arity > 256)) {
      throw new RangeError('UI adapter arity must be between 0 and 256');
    }
    if (typeof handler !== 'function') throw new TypeError('A UI member handler is required');
    const key = memberKey(kind, name, arity);
    const members = this.owners.get(owner) ?? new Map();
    if (members.has(key)) throw new TypeError(`Duplicate UI adapter ${owner}::${name}`);
    members.set(key, handler);
    this.owners.set(owner, members);
    let registered = true;
    return () => {
      if (!registered) return false;
      registered = false;
      members.delete(key);
      if (!members.size) this.owners.delete(owner);
      return true;
    };
  }

  /** Resolve exact arity before wildcard, then walk only declared type ancestry. */
  resolve(descriptor, argumentCount) {
    let owner = this.canonicalType(descriptor.owner);
    const exact = memberKey(descriptor.kind, descriptor.name, argumentCount);
    const wildcard = memberKey(descriptor.kind, descriptor.name, '*');
    const seen = new Set();
    while (owner) {
      if (seen.has(owner) || seen.size >= this.maxDepth) throw new TypeError('UI adapter inheritance cycle or depth limit');
      seen.add(owner);
      const members = this.owners.get(owner);
      const handler = members?.get(exact) ?? members?.get(wildcard);
      if (handler) return handler;
      owner = this.baseType(owner);
    }
    return null;
  }

  /** Execute a registered synchronous bridge; asynchronous operations return managed task values. */
  invoke(context, descriptor, receiver, args) {
    if (!descriptor || !Array.isArray(args)) throw new TypeError('A member descriptor and argument array are required');
    const handler = this.resolve(descriptor, args.length);
    if (!handler) return unhandled;
    const value = handler({context, descriptor, receiver, args});
    if (value && typeof value.then === 'function' && !context.isTask?.(value)) {
      throw new TypeError('UI adapters must return synchronously; bridge asynchronous work through an explicit task service');
    }
    return {handled: true, value};
  }

  clear() {
    this.owners.clear();
  }
}
