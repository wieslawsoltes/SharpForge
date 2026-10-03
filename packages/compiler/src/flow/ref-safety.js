/**
 * Ref safety: escape-scope analysis (SF-A02-T04.6, C# 11 rules; csharp-11.0/low-level-struct-improvements).
 *
 * Every expression has a *safe context* (how far its value may escape - only interesting for ref structs, which can
 * hold references) and, when it is a variable, a *ref safe context* (how far a reference to it may escape). Contexts
 * are ordered: CallingMethod (anywhere) < ReturnOnly (out of the method by return or ref/out parameter only) <
 * CurrentMethod < nested local scopes (larger numbers are narrower).
 *   CS8352  a value whose safe context is narrower than its destination allows
 *   CS8353  a stackalloc result escaping          CS8350 / CS8351  a call that could mix arguments of different scopes
 *   CS8374  ref assignment to a narrower ref      CS8166 / CS8168 / CS9075 / CS9077  returning a reference too narrow
 * `scoped` narrows a parameter or local to the current method; `[UnscopedRef]` widens `this` of a struct, an `out`
 * parameter or a `ref` parameter of a ref struct to ReturnOnly.
 */
import { RefKind, TypeKind } from '../symbols/types.js';
import { isRefLike } from '../binder/ref-struct.js';

export const EscapeScope = Object.freeze({ CallingMethod: 0, ReturnOnly: 1, CurrentMethod: 2 });
/** The escape scope of a local scope nested `depth` levels inside the method body (0 = the body itself). */
export const localScope = depth => EscapeScope.CurrentMethod + depth;
const narrowest = list => list.reduce((a, b) => Math.max(a, b), EscapeScope.CallingMethod);

export class RefSafety {
  /** @param {{useUpdatedEscapeRules?:boolean}} [options] C# 11 rules (default) or the C# 7.2-10 rules (ref parameters escape to the calling method; out parameters too) */
  constructor(options = {}) {
    this.updated = options.useUpdatedEscapeRules !== false;
    this.locals = new Map();
  }
  /** Declares a local at a scope depth; `scoped` pins it to the current scope regardless of its initializer. */
  declareLocal(local, depth, { scoped = false } = {}) {
    this.locals.set(local, {
      scope: localScope(depth),
      safe: scoped || !isRefLike(local.type) ? (isRefLike(local.type) ? localScope(depth) : EscapeScope.CallingMethod) : null,
      refSafe: local.refKind === RefKind.None ? localScope(depth) : null,
      scoped,
    });
    return this;
  }
  /** Records what an initializer or (ref) assignment gives a local. Ref-struct locals take the safe context of their initializer; ref locals its ref safe context. */
  initializeLocal(local, initializer, { isRef = false } = {}) {
    const entry = this.locals.get(local);
    if (!entry) return;
    if (isRef) {
      if (entry.refSafe === null || !entry.scoped) entry.refSafe = entry.scoped ? entry.scope : this.refSafeContext(initializer);
      if (isRefLike(local.type) && entry.safe === null) entry.safe = this.safeContext(initializer);
    } else if (entry.safe === null) entry.safe = initializer ? this.safeContext(initializer) : EscapeScope.CallingMethod;
  }
  /** The ref safe context of a parameter. */
  parameterRefSafe(p) {
    if (p.refKind === RefKind.None) return EscapeScope.CurrentMethod;
    if (p.scoped) return EscapeScope.CurrentMethod;
    if (p.refKind === RefKind.Out) return this.updated && !p.isUnscopedRef ? EscapeScope.CurrentMethod : EscapeScope.ReturnOnly;
    return this.updated ? EscapeScope.ReturnOnly : EscapeScope.CallingMethod;
  }
  /** The safe context of a parameter's value. */
  parameterSafe(p) {
    if (!isRefLike(p.type)) return EscapeScope.CallingMethod;
    if (p.scoped && p.refKind === RefKind.None) return EscapeScope.CurrentMethod;
    return p.refKind === RefKind.Out && this.updated
      ? EscapeScope.ReturnOnly
      : p.refKind === RefKind.None
        ? EscapeScope.CallingMethod
        : EscapeScope.CallingMethod;
  }
  /** How far a reference to the variable `e` may escape. Non-variables are CurrentMethod (a temporary). */
  refSafeContext(e) {
    switch (e.kind) {
      case 'Local':
        return this.locals.get(e.local)?.refSafe ?? this.locals.get(e.local)?.scope ?? EscapeScope.CurrentMethod;
      case 'Parameter':
        return this.parameterRefSafe(e.parameter);
      case 'This':
        return e.type?.isValueType === true
          ? e.isUnscopedRef
            ? EscapeScope.ReturnOnly
            : EscapeScope.CurrentMethod
          : EscapeScope.CallingMethod;
      case 'ArrayAccess':
        return EscapeScope.CallingMethod;
      case 'FieldAccess': {
        if (e.field.isStatic || !e.receiver || e.receiver.type?.isValueType !== true) return EscapeScope.CallingMethod;
        // A ref field's referent escapes like the struct value; an ordinary field like the struct variable.
        if (e.field.refKind && e.field.refKind !== RefKind.None) return this.safeContext(e.receiver);
        return this.refSafeContext(e.receiver);
      }
      case 'Call':
      case 'PropertyAccess':
      case 'IndexerAccess': {
        const refKind = e.method?.refKind ?? e.property?.refKind;
        if (!refKind || refKind === RefKind.None) return EscapeScope.CurrentMethod;
        return this.invocationContext(e);
      }
      case 'RefConditional':
        return narrowest([this.refSafeContext(e.whenTrue), this.refSafeContext(e.whenFalse)]);
      case 'Conversion':
        return e.isImplicitIdentity ? this.refSafeContext(e.operand) : EscapeScope.CurrentMethod;
      default:
        return EscapeScope.CurrentMethod;
    }
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
        return EscapeScope.CallingMethod;
      case 'StackAlloc':
        return EscapeScope.CurrentMethod;
      case 'Default':
      case 'Literal':
        return EscapeScope.CallingMethod;
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
      case 'Conversion':
        return e.conversion?.kind === 'ImplicitSpan' && e.operand.type?.typeKind === TypeKind.Array
          ? EscapeScope.CallingMethod
          : this.safeContext(e.operand);
      case 'Coalesce':
        return narrowest([this.safeContext(e.left), this.safeContext(e.right)]);
      case 'CollectionExpression':
        return e.isStackAllocated ? EscapeScope.CurrentMethod : EscapeScope.CallingMethod;
      default:
        return EscapeScope.CallingMethod;
    }
  }
  /** A method invocation's result is as narrow as the narrowest thing it was given: argument values, and referents of by-reference arguments. */
  invocationContext(e) {
    const scopes = [];
    if (e.receiver && e.receiver.type?.isValueType === true) {
      scopes.push(this.safeContext(e.receiver));
      if (isRefLike(e.receiver.type) === false && (e.method?.isUnscopedRef || e.property?.isUnscopedRef))
        scopes.push(this.refSafeContext(e.receiver));
    }
    for (const a of e.args ?? []) {
      const value = a.expression ?? a,
        p = a.parameter;
      scopes.push(this.safeContext(value));
      const refKind = a.refKind ?? p?.refKind;
      if (refKind && refKind !== RefKind.None && refKind !== RefKind.Out && !p?.scoped) scopes.push(this.refSafeContext(value));
    }
    return narrowest(scopes);
  }
  /**
   * Checks that a value may be stored where the destination lives.
   * @returns {null|{code,args}} CS8352 (named variable), CS8353 (stackalloc) or CS8347/CS8350 for calls
   */
  checkValueEscape(value, destinationScope) {
    const scope = this.safeContext(value);
    if (scope <= destinationScope) return null;
    if (value.kind === 'StackAlloc') return { code: 'CS8353', args: [value.type.toDisplayString()] };
    if (value.kind === 'Local') return { code: 'CS8352', args: [value.local.name] };
    if (value.kind === 'Parameter') return { code: 'CS8352', args: [value.parameter.name] };
    if (value.kind === 'Call' || value.kind === 'ObjectCreation') {
      const bad = (value.args ?? []).find(
        a =>
          Math.max(
            this.safeContext(a.expression ?? a),
            a.refKind && a.refKind !== RefKind.None && a.refKind !== RefKind.Out ? this.refSafeContext(a.expression ?? a) : 0,
          ) > destinationScope,
      );
      return {
        code: 'CS8347',
        args: [(value.method ?? value.constructor).toDisplayString(), bad?.parameter?.name ?? ''],
        inner: bad ? this.checkValueEscape(bad.expression ?? bad, destinationScope) : null,
      };
    }
    if (value.kind === 'Conversion' || value.kind === 'Conditional')
      return (
        this.checkValueEscape(value.operand ?? value.whenTrue, destinationScope) ?? this.checkValueEscape(value.whenFalse, destinationScope)
      );
    return { code: 'CS8352', args: [value.syntax?.toString?.() ?? ''] };
  }
  /** `return value;` - the value must be able to leave the method. */
  checkReturn(value) {
    return this.checkValueEscape(value, EscapeScope.ReturnOnly);
  }
  /** `destination = value;` for ref struct values. */
  checkAssignment(destination, value) {
    if (!destination.type || !isRefLike(destination.type)) return null;
    // Assigning into a by-reference parameter or its fields lets the value escape through it.
    const target =
      destination.kind === 'Local'
        ? (this.locals.get(destination.local)?.safe ?? EscapeScope.CallingMethod)
        : destination.kind === 'Parameter'
          ? destination.parameter.refKind === RefKind.None
            ? this.parameterSafe(destination.parameter)
            : EscapeScope.ReturnOnly
          : destination.kind === 'FieldAccess'
            ? this.safeContext(destination.receiver ?? destination)
            : EscapeScope.CallingMethod;
    return this.checkValueEscape(value, target);
  }
  /** `destination = ref source;` - the new referent must live at least as long as the ref variable may (CS8374). */
  checkRefAssignment(destination, source) {
    const target =
      destination.kind === 'Local'
        ? (this.locals.get(destination.local)?.refSafe ?? EscapeScope.CurrentMethod)
        : destination.kind === 'Parameter'
          ? this.parameterRefSafe(destination.parameter)
          : this.safeContext(destination.receiver ?? destination);
    return this.refSafeContext(source) > target ? { code: 'CS8374', args: [describe(destination), describe(source)] } : null;
  }
  /** `return ref e;` - the referent must outlive the method (ReturnOnly or wider). */
  checkRefReturn(e) {
    const scope = this.refSafeContext(e);
    if (scope <= EscapeScope.ReturnOnly) return null;
    if (e.kind === 'Local') return { code: 'CS8168', args: [e.local.name] };
    if (e.kind === 'Parameter')
      return { code: e.parameter.refKind === RefKind.None ? 'CS8166' : e.parameter.scoped ? 'CS9075' : 'CS9076', args: [e.parameter.name] };
    if (e.kind === 'FieldAccess' && e.receiver?.kind === 'This') return { code: 'CS8170', args: [] };
    return { code: 'CS8156', args: [] };
  }
  /**
   * Method arguments must match (CS8350): when a ref struct is passed by writable reference, no other argument may
   * have a narrower safe context, or the callee could store the narrow value into the wide variable.
   */
  checkArgumentsMatch(call) {
    const args = call.args ?? [],
      writable = args.filter(a => (a.refKind === RefKind.Ref || a.refKind === RefKind.Out) && isRefLike((a.expression ?? a).type));
    if (!writable.length) return null;
    const widest = Math.min(...writable.map(a => this.safeContext(a.expression ?? a)));
    const offender = args.find(
      a =>
        Math.max(
          this.safeContext(a.expression ?? a),
          a.refKind && a.refKind !== RefKind.None && a.refKind !== RefKind.Out && !a.parameter?.scoped
            ? this.updated && isRefLike((a.expression ?? a).type)
              ? this.safeContext(a.expression ?? a)
              : this.refSafeContext(a.expression ?? a)
            : 0,
        ) > widest,
    );
    return offender
      ? {
          code: 'CS8350',
          args: [(call.method ?? call.constructor).toDisplayString(), offender.parameter?.name ?? ''],
          inner: { code: 'CS8352', args: [describe(offender.expression ?? offender)] },
        }
      : null;
  }
}
const describe = e =>
  e.kind === 'Local'
    ? e.local.name
    : e.kind === 'Parameter'
      ? e.parameter.name
      : e.kind === 'FieldAccess'
        ? e.field.name
        : (e.syntax?.toString?.() ?? '');
