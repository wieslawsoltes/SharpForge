import { MethodDesc } from './method-desc.js';
import { OverrideSignatures } from './override-signature.js';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const fail = message => loadError(LoadErrorCode.TypeLoad, message);

/** Resolve implicit class override roots; unsupported explicit slot mappings fail instead of inventing roots. */
export class MethodBaseDefinitions {
  #loader;
  #maxDepth;
  #maxRows;
  #signatures;
  #roots = new WeakMap();
  #methods = new WeakMap();
  #implementations = new WeakMap();
  constructor(loader, { maxDepth, maxMetadataRows }) {
    this.#loader = loader;
    this.#maxDepth = maxDepth;
    this.#maxRows = maxMetadataRows;
    this.#signatures = new OverrideSignatures(loader, maxMetadataRows);
  }
  async get(method, { signal } = {}) {
    if (!(method instanceof MethodDesc)) throw new TypeError('Expected MethodDesc');
    checkCancellation(signal);
    if (method.loadContext.types !== this.#loader) return method.loadContext.types.getBaseDefinition(method, { signal });
    if (this.#roots.has(method)) return this.#roots.get(method);
    if (method.isStatic || !method.isVirtual || method.declaringType.isInterface) return method;
    this.#guard(method.declaringType);
    if (method.flags & 0x100) return method;
    const declaring = await this.#loader.load(method.module, method.declaringType.metadataToken, { signal });
    const key = await this.#signatures.key(method, signal);
    let root = method;
    let depth = 0;
    let visited = 0;
    const seen = new Set([declaring]);
    for (let type = declaring.baseType; type; type = type.baseType) {
      checkCancellation(signal);
      if (++depth > this.#maxDepth) throw loadError(LoadErrorCode.LimitExceeded, 'Method override hierarchy depth exceeded');
      if (seen.has(type)) throw fail('Circular method override hierarchy');
      seen.add(type);
      this.#guard(type);
      const candidates = this.#index(type).get(method.name) ?? [];
      let match = null;
      for (const candidate of candidates) {
        if (++visited > this.#maxRows) throw loadError(LoadErrorCode.LimitExceeded, 'Method override candidate limit exceeded');
        if (await this.#signatures.key(candidate, signal) !== key) continue;
        if (match) throw loadError(LoadErrorCode.InvalidImage, 'Ambiguous virtual method metadata');
        match = candidate;
      }
      if (!match) continue;
      if (!match.isVirtual) throw fail('A nonvirtual method cannot be overridden');
      if (match.isFinal) throw fail('A final virtual method cannot be overridden');
      if (match.flags & 0x200) throw fail('Strict override accessibility requires the reflection access service');
      root = match;
      if (match.flags & 0x100) break;
    }
    checkCancellation(signal);
    this.#roots.set(method, root);
    return root;
  }
  #index(type) {
    if (this.#methods.has(type)) return this.#methods.get(type);
    if (type.module.rowCount(6) > this.#maxRows) throw loadError(LoadErrorCode.LimitExceeded, 'Method override row limit exceeded');
    const methods = type.module.methodDefinitions(type.metadataToken);
    if (methods.length > this.#maxRows) throw loadError(LoadErrorCode.LimitExceeded, 'Method override row limit exceeded');
    const index = new Map();
    for (const method of methods) {
      if (method.isStatic) continue;
      if (!index.has(method.name)) index.set(method.name, []);
      index.get(method.name).push(method);
    }
    this.#methods.set(type, index);
    return index;
  }
  #guard(type) {
    const module = type.module;
    if (!module || type.metadataToken >>> 24 !== 2) throw fail('Base virtual methods require metadata; intrinsic slots are not available');
    if (!this.#implementations.has(module)) {
      const count = module.rowCount(25);
      if (count > this.#maxRows) throw loadError(LoadErrorCode.LimitExceeded, 'MethodImpl row limit exceeded');
      const owners = new Set();
      const typeCount = module.rowCount(2);
      for (let row = 1; row <= count; row++) {
        const owner = module.row(0x19000000 + row)[0];
        if (!Number.isInteger(owner) || owner < 1 || owner > typeCount) {
          throw loadError(LoadErrorCode.InvalidImage, 'Invalid MethodImpl owner');
        }
        owners.add(owner);
      }
      this.#implementations.set(module, owners);
    }
    if (this.#implementations.get(module).has(type.metadataToken & 0xffffff)) {
      throw fail('MethodImpl and covariant override mappings require an explicit slot service');
    }
  }
}
