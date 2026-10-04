import { TypeDesc, TypeKind } from './type-desc.js';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const fail = message => loadError(LoadErrorCode.TypeLoad, message);
const arrays = new Set([TypeKind.SZArray, TypeKind.Array]);
const references = new Set([TypeKind.Class, TypeKind.Interface, TypeKind.SZArray, TypeKind.Array]);
const unsupported = new Set([TypeKind.Pointer, TypeKind.ByRef, TypeKind.FunctionPointer, TypeKind.GenericParameter]);
const integralGroups = Object.freeze([
  ['System.SByte', 'System.Byte'], ['System.Int16', 'System.UInt16'],
  ['System.Int32', 'System.UInt32'], ['System.Int64', 'System.UInt64'], ['System.IntPtr', 'System.UIntPtr'],
]);
const vectorContracts = Object.freeze(['IEnumerable', 'ICollection', 'IList', 'IReadOnlyCollection', 'IReadOnlyList']
  .map(name => `System.Collections.Generic.${name}\`1`));

/** Bounded metadata assignability. Results describe type conversion, not instance casting or execution. */
export class TypeAssignability {
  #maxDepth;
  #maxRows;
  #cache = new WeakMap();
  #genericOwners = new WeakMap();
  constructor({ maxDepth, maxMetadataRows }) { this.#maxDepth = maxDepth; this.#maxRows = maxMetadataRows; }

  isAssignableFrom(target, source, { signal } = {}) {
    checkCancellation(signal);
    if (!(target instanceof TypeDesc) || !(source instanceof TypeDesc)) throw new TypeError('Expected target and source TypeDesc');
    return this.#assign(target, source, { signal, depth: 0 });
  }

  #hasGenericDefinition(type) {
    if (type.genericParameters.length) return true;
    if (!type.module || type.metadataToken >>> 24 !== 2) return false;
    if (!this.#genericOwners.has(type.module)) {
      const count = type.module.rowCount(42);
      if (count > this.#maxRows) throw loadError(LoadErrorCode.LimitExceeded, 'Assignability generic metadata limit exceeded');
      const owners = new Set();
      for (let rid = 1; rid <= count; rid++) {
        const owner = type.module.row(0x2a000000 + rid)[2];
        if (!(owner & 1)) owners.add(0x02000000 + (owner >>> 1));
      }
      this.#genericOwners.set(type.module, owners);
    }
    return this.#genericOwners.get(type.module).has(type.metadataToken);
  }

  #check(type) {
    if (!type.isLoaded) throw fail('Assignability requires a loaded type graph');
    if (unsupported.has(type.kind)) throw fail(`Assignability for ${type.kind} requires a later casting batch`);
    if (this.#hasGenericDefinition(type)) throw fail('Generic definition assignability requires generic type services');
  }

  #assign(target, source, operation) {
    checkCancellation(operation.signal);
    if (operation.depth >= this.#maxDepth) throw loadError(LoadErrorCode.LimitExceeded, 'Assignability depth exceeded');
    this.#check(target);
    this.#check(source);
    const vectorTarget = target.kind === TypeKind.Instantiation && target.genericArguments.length === 1 &&
      vectorContracts.some(name => source.loadContext.types.isIntrinsic(target.genericDefinition, name));
    if (source.kind === TypeKind.Instantiation || (target.kind === TypeKind.Instantiation && !vectorTarget)) {
      throw fail('Generic variance and Nullable assignability require generic type services');
    }
    const cached = this.#cache.get(target)?.get(source);
    if (cached !== undefined) return cached;
    const nested = { ...operation, depth: operation.depth + 1 };
    let result;
    if (target === source) result = true;
    else if (vectorTarget) result = source.kind === TypeKind.SZArray && this.#parameter(target.genericArguments[0], source.elementType, nested);
    else if (arrays.has(target.kind)) result = arrays.has(source.kind) && target.rank === source.rank &&
      (target.kind !== TypeKind.SZArray || source.kind === TypeKind.SZArray) && this.#parameter(target.elementType, source.elementType, nested);
    else if (target.isInterface) result = source.interfaces.includes(target);
    else if (source.isInterface && source.loadContext.types.isIntrinsic(target, 'System.Object')) result = true;
    else {
      result = false;
      let depth = operation.depth;
      for (let current = source.baseType; current; current = current.baseType) {
        checkCancellation(operation.signal);
        if (++depth >= this.#maxDepth) throw loadError(LoadErrorCode.LimitExceeded, 'Assignability depth exceeded');
        this.#check(current);
        if (current === target) { result = true; break; }
      }
    }
    if (!this.#cache.has(target)) this.#cache.set(target, new WeakMap());
    this.#cache.get(target).set(source, result);
    return result;
  }

  #parameter(target, source, operation) {
    this.#check(target);
    this.#check(source);
    if (target === source) return true;
    if ([target.kind, source.kind].includes(TypeKind.Instantiation)) throw fail('Generic element assignability requires generic type services');
    if (references.has(source.kind)) return this.#assign(target, source, operation);
    const left = source.kind === TypeKind.Enum ? source.underlyingType : source;
    const right = target.kind === TypeKind.Enum ? target.underlyingType : target;
    if (!left || !right) throw fail('Enum element assignability requires its underlying type');
    // Primitive array conversions use CLI element categories; ordinary boxed conversions do not.
    return integralGroups.some(names => names.some(name => left.loadContext.types.isIntrinsic(left, name)) &&
      names.some(name => right.loadContext.types.isIntrinsic(right, name)));
  }
}
