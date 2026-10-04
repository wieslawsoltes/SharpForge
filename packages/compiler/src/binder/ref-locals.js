/**
 * ref locals, ref returns and ref reassignment (SF-A02-T04.3; C# 7.0, 7.2, 7.3).
 *
 *   ref int r = ref x;          C# 7.0  the initializer must be `ref` of a variable (CS8172, CS8156, CS1510)
 *   ref readonly int r = ref x; C# 7.2  no writes through r (CS8331)
 *   r = ref y;                  C# 7.3  ref reassignment ("ref reassignment" feature gate)
 *   c ? ref a : ref b           C# 7.2  conditional ref expression: both arms are variables of the same type
 *   return ref x;               the method must return by reference (CS8149), by-value methods cannot (CS8150);
 *                               x must be returnable: not a by-value parameter (CS8166), not a local (CS8168) or a
 *                               ref local initialised from something non-returnable (CS8157)
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { RefKind } from '../symbols/types.js';
import { classifyVariable } from './ref-kinds.js';

export const refLocalsFeature = Object.freeze({ name: 'byref locals and returns', version: 7 });
export const refReadonlyFeature = Object.freeze({ name: 'readonly references', version: 7.2 });
export const refReassignmentFeature = Object.freeze({ name: 'ref reassignment', version: 7.3 });
export const refConditionalFeature = Object.freeze({ name: 'ref conditional expression', version: 7.2 });
/**
 * Checks the initializer of a local declared `ref` (or not) against an initializer written with `ref` (or not).
 * @returns {null|{code,args}}
 */
export function checkRefLocalInitializer(localIsRef, initializerIsRef, initializer, context) {
  if (localIsRef && !initializer) return { code: DiagnosticId.CS8174, args: [] };
  if (localIsRef && !initializerIsRef) return { code: DiagnosticId.CS8172, args: [] };
  if (!localIsRef && initializerIsRef) return { code: DiagnosticId.CS8171, args: [] };
  if (!localIsRef) return null;
  const c = classifyVariable(initializer, context);
  if (!c.isVariable) return { code: c.isProperty ? DiagnosticId.CS0206 : DiagnosticId.CS1510, args: [] };
  return null;
}
/** A `ref` (non-readonly) local or return needs a writable variable; `ref readonly` accepts read-only ones. */
export function checkRefWritability(expression, targetIsReadonly, context) {
  if (targetIsReadonly) return null;
  const c = classifyVariable(expression, context);
  if (c.isVariable && !c.isWritable) {
    if (c.reason === 'readonlyField') return { code: c.symbol.isStatic ? DiagnosticId.CS0199 : DiagnosticId.CS0192, args: [] };
    if (c.reason === 'readonlyRef') return { code: DiagnosticId.CS8329, args: [c.detail, c.symbol.name] };
    if (c.reason === 'readonlyLocal') return { code: DiagnosticId.CS1657, args: [c.symbol.name, c.detail] };
  }
  return null;
}
/**
 * Where a variable may be returned by reference from: 'returnable' (heap, ref parameters, ref-returning calls),
 * or the reason it is not: {code,args}.
 * @param expression bound expression used as `return ref e` (or as the initializer of a ref local that is later returned)
 */
export function refReturnability(expression, context = {}) {
  switch (expression.kind) {
    case 'Local': {
      const l = expression.local;
      if (l.refKind === RefKind.None) return { code: DiagnosticId.CS8168, args: [l.name] };
      if (l.refReturnable === false) return { code: DiagnosticId.CS8157, args: [l.name] };
      return 'returnable';
    }
    case 'Parameter': {
      const p = expression.parameter;
      if (p.refKind === RefKind.None) return { code: DiagnosticId.CS8166, args: [p.name] };
      if (p.scoped) return { code: DiagnosticId.CS9075, args: [p.name] };
      return 'returnable';
    }
    case 'ArrayAccess':
      return 'returnable';
    case 'This':
      return context.containingType?.isValueType ? { code: DiagnosticId.CS8170, args: [] } : 'returnable';
    case 'FieldAccess': {
      if (expression.field.isStatic || !expression.receiver || expression.receiver.type?.isValueType !== true) return 'returnable';
      const inner = refReturnability(expression.receiver, context);
      if (inner === 'returnable') return inner;
      // A field of a non-returnable struct variable: Roslyn names the member (CS8167/CS8169) or `this` (CS8170).
      if (inner.code === DiagnosticId.CS8166) return { code: DiagnosticId.CS8167, args: inner.args };
      if (inner.code === DiagnosticId.CS8168) return { code: DiagnosticId.CS8169, args: inner.args };
      return inner;
    }
    case 'Call':
    case 'PropertyAccess':
    case 'IndexerAccess': {
      const refKind = expression.method?.refKind ?? expression.property?.refKind;
      if (!refKind || refKind === RefKind.None) return { code: DiagnosticId.CS8156, args: [] };
      // A ref-returning call is returnable when every by-ref argument (and a struct receiver) is.
      for (const a of expression.args ?? []) {
        if (a.refKind && a.refKind !== RefKind.None && a.refKind !== RefKind.Out) {
          const r = refReturnability(a.expression ?? a, context);
          if (r !== 'returnable')
            return {
              code: DiagnosticId.CS8347,
              args: [(expression.method ?? expression.property).toDisplayString(), a.parameterName ?? ''],
              inner: r,
            };
        }
      }
      return 'returnable';
    }
    case 'RefConditional': {
      const a = refReturnability(expression.whenTrue, context);
      if (a !== 'returnable') return a;
      return refReturnability(expression.whenFalse, context);
    }
    default:
      return { code: DiagnosticId.CS8156, args: [] };
  }
}
/**
 * Checks a return statement against the method's return ref kind.
 * @returns {null|{code,args}}
 */
export function checkRefReturn(methodRefKind, returnIsRef, expression, context) {
  const byRef = methodRefKind && methodRefKind !== RefKind.None;
  if (byRef && !returnIsRef) return { code: DiagnosticId.CS8150, args: [] };
  if (!byRef && returnIsRef) return { code: DiagnosticId.CS8149, args: [] };
  if (!byRef || !expression) return null;
  const c = classifyVariable(expression, context);
  if (!c.isVariable) return { code: DiagnosticId.CS8156, args: [] };
  const writable = checkRefWritability(expression, methodRefKind === RefKind.RefReadOnly, context);
  if (writable)
    return { code: writable.code === DiagnosticId.CS0192 ? DiagnosticId.CS8160 : writable.code === DiagnosticId.CS0199 ? DiagnosticId.CS8161 : writable.code, args: writable.args };
  // Whether the referent may leave the method is decided by ref safety (flow/ref-safety.js) for method bodies.
  if (context.escapeCheckedByFlow) return null;
  const r = refReturnability(expression, context);
  return r === 'returnable' ? null : r;
}
/** Records on a ref local whether it may itself be returned by reference (decided by its initializer). */
export function recordRefLocal(local, initializer, context) {
  local.refReturnable = refReturnability(initializer, context) === 'returnable';
  return local;
}
/** Both arms of `c ? ref a : ref b` must be variables with identical types (CS8326/CS8327). */
export function checkRefConditional(whenTrue, whenFalse, trueIsRef, falseIsRef, context) {
  if (trueIsRef !== falseIsRef) return { code: DiagnosticId.CS8326, args: [] };
  if (!trueIsRef) return null;
  for (const e of [whenTrue, whenFalse]) if (!classifyVariable(e, context).isVariable) return { code: DiagnosticId.CS1510, args: [] };
  if (whenTrue.type && whenFalse.type && !whenTrue.type.equals(whenFalse.type)) return { code: DiagnosticId.CS8327, args: [] };
  return null;
}
