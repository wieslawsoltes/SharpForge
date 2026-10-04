/**
 * Safe contexts of ref safety (C# 11 "low-level struct improvements"; Roslyn's RefSafetyAnalysis).
 *
 * Every expression has a *safe context* (how far its value may escape; only ref structs are interesting, they can
 * hold references) and every variable a *ref safe context* (how far a reference to it may escape). Contexts are
 * ordered numbers, wider first: CallingMethod < ReturnOnly < CurrentMethod < nested local scopes.
 */
import { RefKind, TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { isRefLike } from '../../binder/ref-struct.js';
import { isUnscopedRef, isScopedParameter, isRefField, invokedMethod, isByReference } from './symbols.js';

export const EscapeScope = Object.freeze({ CallingMethod: 0, ReturnOnly: 1, CurrentMethod: 2 });

/** The escape scope of a local scope nested `depth` levels inside the method body (0 = the body itself). */
export const localScope = depth => EscapeScope.CurrentMethod + depth;

const narrowest = scopes => scopes.reduce((a, b) => Math.max(a, b), EscapeScope.CallingMethod);
const invocationKinds = new Set(['Call', 'ObjectCreation', 'PropertyAccess', 'IndexerAccess']);

/** Strips `ref e` wrappers and identity conversions: the variable an expression denotes. */
export function variableOf(expression) {
  let current = expression;
  while (current && (current.kind === 'Ref' || (current.kind === 'Conversion' && current.isImplicitIdentity))) current = current.operand;
  return current;
}

/** True for `a[^1]` over an array: an element, which lives on the heap. */
const isHeapElement = e => e.accessKind === 'index' && (!e.access || e.access.kind === 'ArrayAccess');

/**
 * The by-reference indexer call `a[^1]` stands for, on the real receiver (the access is bound over a placeholder; the
 * offset is an `int` and holds no reference); null for an array element, a slice and a by-value indexer.
 */
export function implicitIndexInvocation(e) {
  if (e.accessKind !== 'index' || isHeapElement(e)) return null;
  const access = e.access;
  if (!isByReference(access.property?.refKind ?? access.method?.refKind)) return null;
  return { ...access, receiver: e.receiver, args: [] };
}

export class EscapeContexts {
  /**
   * @param {object} [options]
   * @param {boolean} [options.useUpdatedEscapeRules] C# 11 rules (default) or the C# 7.2-10 rules
   * @param {object|null} [options.method] the method being analysed (decides what `this` may escape to)
   */
  constructor(options = {}) {
    this.updated = options.useUpdatedEscapeRules !== false;
    this.method = options.method ?? null;
    this.locals = options.locals ?? new Map();
  }
  /** Declares a local at a scope depth; `scoped` pins it to that scope regardless of its initializer. */
  declareLocal(local, depth, { scoped = false } = {}) {
    const scope = localScope(depth);
    const refLike = isRefLike(local.type);
    this.locals.set(local, {
      scope,
      safe: !refLike ? EscapeScope.CallingMethod : scoped ? scope : null,
      refSafe: local.refKind === RefKind.None || !local.refKind ? scope : scoped ? scope : null,
      scoped,
    });
    return this;
  }
  /**
   * Records what an initializer gives a local: a ref-struct local takes the safe context of its initializer, a ref
   * local the ref safe context of its referent. Without an initializer the value may escape anywhere.
   */
  initializeLocal(local, initializer, { isRef = false } = {}) {
    const entry = this.locals.get(local);
    if (!entry) return;
    if (isRef && entry.refSafe === null) entry.refSafe = initializer ? this.refSafeContext(initializer) : entry.scope;
    if (entry.safe === null) entry.safe = initializer ? this.safeContext(initializer) : EscapeScope.CallingMethod;
  }
  /** The ref safe context of a parameter. */
  parameterRefSafe(parameter) {
    const refKind = parameter.refKind ?? RefKind.None;
    if (refKind === RefKind.None) return EscapeScope.CurrentMethod;
    if (isScopedParameter(parameter)) return EscapeScope.CurrentMethod;
    if (!this.updated) return EscapeScope.CallingMethod;
    if (refKind === RefKind.Out) return isUnscopedRef(parameter) ? EscapeScope.ReturnOnly : EscapeScope.CurrentMethod;
    return isUnscopedRef(parameter) ? EscapeScope.CallingMethod : EscapeScope.ReturnOnly;
  }
  /** The safe context of a parameter's value. */
  parameterSafe(parameter) {
    if (!isRefLike(parameter.type)) return EscapeScope.CallingMethod;
    const refKind = parameter.refKind ?? RefKind.None;
    if (refKind === RefKind.None && isScopedParameter(parameter)) return EscapeScope.CurrentMethod;
    return refKind === RefKind.Out && this.updated ? EscapeScope.ReturnOnly : EscapeScope.CallingMethod;
  }
  /** True when `this` is a struct receiver the current member may return references into (`[UnscopedRef]`). */
  get thisIsUnscoped() {
    return isUnscopedRef(this.method);
  }
  /** `this` of a struct: a reference to it stays in the method unless the member is `[UnscopedRef]`. */
  thisRefSafe(type) {
    if (type?.isValueType !== true) return EscapeScope.CallingMethod;
    return this.thisIsUnscoped ? EscapeScope.ReturnOnly : EscapeScope.CurrentMethod;
  }
  /** The value of `this`: in a constructor it is an `out` parameter (return only), elsewhere it came from the caller. */
  thisSafe(type) {
    if (!isRefLike(type)) return EscapeScope.CallingMethod;
    return this.updated && this.method?.methodKind === MethodKind.Constructor ? EscapeScope.ReturnOnly : EscapeScope.CallingMethod;
  }
  /** How far a reference to the variable `e` may escape. Values (temporaries) stay in the current method. */
  refSafeContext(expression) {
    const e = variableOf(expression);
    if (!e) return EscapeScope.CurrentMethod;
    switch (e.kind) {
      case 'Local': {
        const entry = this.locals.get(e.local);
        return entry?.refSafe ?? entry?.scope ?? EscapeScope.CurrentMethod;
      }
      case 'Parameter':
        return this.parameterRefSafe(e.parameter);
      case 'This':
        return this.thisRefSafe(e.type);
      case 'ArrayAccess':
        return EscapeScope.CallingMethod;
      case 'FieldAccess': {
        if (e.field.isStatic || !e.receiver || e.receiver.type?.isValueType !== true) return EscapeScope.CallingMethod;
        // The referent of a ref field escapes like the struct value; an ordinary field like the struct variable.
        return isRefField(e.field) ? this.safeContext(e.receiver) : this.refSafeContext(e.receiver);
      }
      case 'Call':
      case 'PropertyAccess':
      case 'IndexerAccess': {
        const refKind = e.method?.refKind ?? e.property?.refKind;
        return isByReference(refKind) ? this.invocationContext(e) : EscapeScope.CurrentMethod;
      }
      case 'RefConditional':
        return narrowest([this.refSafeContext(e.whenTrue), this.refSafeContext(e.whenFalse)]);
      case 'ImplicitIndexerAccess':
        return this.implicitIndexRefSafe(e);
      default:
        return EscapeScope.CurrentMethod;
    }
  }
  /**
   * `a[^1]` denotes what `a[a.Length - 1]` does: an array element lives on the heap, the result of a by-reference
   * indexer escapes like a call on the receiver; a slice (`a[1..]`) and a by-value indexer are values.
   */
  implicitIndexRefSafe(e) {
    if (isHeapElement(e)) return EscapeScope.CallingMethod;
    const invocation = implicitIndexInvocation(e);
    return invocation ? this.invocationContext(invocation) : EscapeScope.CurrentMethod;
  }
  /**
   * The ref safe context of the iteration variable of `foreach (ref T item in collection)`: `item` is the result of
   * the enumerator's by-reference `Current`, so it escapes like what the enumerator holds - for a ref struct
   * collection (a span) the value of the collection; any other enumerator can only refer to the heap.
   */
  iterationRefSafe(collection, loopScope) {
    const type = collection?.type;
    if (!type) return loopScope;
    return isRefLike(type) ? this.safeContext(collection) : EscapeScope.CallingMethod;
  }
  /** How far the value of `e` may escape. Values of types that cannot hold references always escape freely. */
  safeContext(e) {
    if (!e || !e.type || !isRefLike(e.type)) return EscapeScope.CallingMethod;
    switch (e.kind) {
      case 'Local':
        return this.locals.get(e.local)?.safe ?? EscapeScope.CallingMethod;
      case 'Parameter':
        return this.parameterSafe(e.parameter);
      case 'This':
        return this.thisSafe(e.type);
      case 'StackAlloc':
        return EscapeScope.CurrentMethod;
      case 'FieldAccess':
        return e.field.isStatic || !e.receiver ? EscapeScope.CallingMethod : this.safeContext(e.receiver);
      case 'Call':
      case 'ObjectCreation':
      case 'PropertyAccess':
      case 'IndexerAccess':
        return this.invocationContext(e);
      case 'Conditional':
      case 'RefConditional':
        return narrowest([this.safeContext(e.whenTrue), this.safeContext(e.whenFalse)]);
      case 'Ref':
        return this.safeContext(e.operand);
      case 'Conversion':
        // Converting an array (or a string) to a span refers to the heap; other conversions keep what the operand holds.
        return isRefLike(e.operand?.type) || e.operand?.kind === 'StackAlloc' ? this.safeContext(e.operand) : EscapeScope.CallingMethod;
      case 'Coalesce':
        return narrowest([this.safeContext(e.left), this.safeContext(e.right)]);
      case 'CollectionExpression':
        return e.isStackAllocated ? EscapeScope.CurrentMethod : EscapeScope.CallingMethod;
      default:
        return EscapeScope.CallingMethod;
    }
  }
  /**
   * What an invocation is given that its result could hold on to: the value of every ref-struct argument and the
   * referent of every by-reference argument (not `out`, not `scoped`), the receiver included.
   * @returns {{ argument: object, parameter: object|null, isRef: boolean, mixable: boolean }[]}
   */
  escapeValues(node) {
    if (!invocationKinds.has(node.kind)) return [];
    const values = [];
    const method = invokedMethod(node);
    const receiver = node.isExtension ? null : node.receiver;
    if (receiver && receiver.type?.isValueType === true && receiver.type.typeKind !== TypeKind.Enum && !method?.isStatic) {
      const refLike = isRefLike(receiver.type);
      const writable = !receiver.type.isReadOnly && !method?.isReadOnly;
      if (refLike) values.push({ argument: receiver, parameter: null, isRef: false, mixable: writable });
      if (isUnscopedRef(method)) values.push({ argument: receiver, parameter: null, isRef: true, mixable: false });
    }
    for (const entry of node.args ?? []) {
      const argument = entry.expression ?? entry;
      const parameter = entry.parameter ?? null;
      const refKind = parameter?.refKind ?? entry.refKind ?? RefKind.None;
      const scoped = parameter ? isScopedParameter(parameter) : false;
      const refLike = isRefLike(parameter?.type ?? argument.type);
      const unscopedOut = refKind === RefKind.Out && parameter && isUnscopedRef(parameter);
      if (refLike && refKind !== RefKind.Out && !(scoped && refKind === RefKind.None)) {
        const mixable = refKind === RefKind.Ref;
        values.push({ argument, parameter, isRef: false, mixable });
      } else if (refLike && refKind === RefKind.Out) {
        values.push({ argument, parameter, isRef: false, mixable: true, isOut: true });
      }
      if (isByReference(refKind) && !scoped && (refKind !== RefKind.Out || unscopedOut)) {
        values.push({ argument, parameter, isRef: true, mixable: false });
      }
    }
    return values;
  }
  /** An invocation's result is as narrow as the narrowest thing it was given. */
  invocationContext(node) {
    const scopes = [];
    for (const value of this.escapeValues(node)) {
      if (value.isOut) continue;
      scopes.push(value.isRef ? this.refSafeContext(value.argument) : this.safeContext(value.argument));
    }
    return narrowest(scopes);
  }
}
