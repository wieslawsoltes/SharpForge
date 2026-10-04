import { MethodDesc } from './method-desc.js';
import { OverrideSignatures } from './override-signature.js';
import { InterfaceMethodImplementations } from './interface-method-impl.js';
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
  #implementations;
  constructor(loader, { maxDepth, maxMetadataRows }) {
    this.#loader = loader;
    this.#maxDepth = maxDepth;
    this.#maxRows = maxMetadataRows;
    this.#signatures = new OverrideSignatures(loader, maxMetadataRows);
    this.#implementations = new InterfaceMethodImplementations(loader, maxMetadataRows);
  }
  async get(method, { signal } = {}) {
    if (!(method instanceof MethodDesc)) throw new TypeError('Expected MethodDesc');
    checkCancellation(signal);
    if (method.loadContext.types !== this.#loader) return method.loadContext.types.getBaseDefinition(method, { signal });
    if (this.#roots.has(method)) return this.#roots.get(method);
    if (method.isStatic || !method.isVirtual || method.declaringType.isInterface) return method;
    const pending = this.#implementations.check(method.declaringType, signal);
    if (pending) await pending;
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
      const mappings = this.#implementations.check(type, signal);
      if (mappings) await mappings;
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
      const constraints = this.#signatures.checkConstraints(root, match, signal);
      if (constraints) await constraints;
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
}
