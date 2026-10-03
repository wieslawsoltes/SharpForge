/**
 * Enum types and enum operations (SF-A02-T01.5, C# spec 19).
 *
 * `bindEnumMembers` gives every member its constant: the explicit initializer converted to the underlying type
 * (CS0266 without a cast, CS0031 out of range, CS0133 not constant), otherwise the previous member plus one (CS0543
 * on overflow) and 0 for the first; references between members are evaluated on demand with circularity detection
 * (CS0110). The operator set lives with the other predefined operators (overload/operators.js `enumOperator`); this
 * module adds the conversion rules that are specific to enums: only the literal 0 converts implicitly, every numeric
 * type converts explicitly both ways, and constant folding stays in the underlying type.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { ConstantValue } from '../constants/constant-value.js';
import { foldBinary, foldConversion } from '../constants/fold.js';
import { integralRange, numericKind } from '../conversions/numeric.js';

/** The C# keyword of an enum's underlying type ('int' when unspecified). */
export function enumUnderlyingKind(enumType, core) {
  return numericKind(core.enumUnderlying(enumType)) ?? 'int';
}
/**
 * Evaluates the members of a source enum.
 * @param enumType the enum symbol  @param core CoreTypes
 * @param {(syntax,scope,field)=>{constant:ConstantValue|null,type:TypeSymbol|null,errors?:boolean}} evaluate binds an initializer expression
 *   (references to sibling members re-enter through `valueOf`)
 * @param report (uri,node,code,args)
 */
export function bindEnumMembers(enumType, core, evaluate, report) {
  const kind = enumUnderlyingKind(enumType, core),
    [lo, hi] = integralRange(kind),
    fields = enumType.getMembers().filter(m => m.isEnumMember),
    state = new Map();
  const uriOf = f => f.locations[0].uri;
  const valueOf = field => {
    if (state.get(field) === 'done') return field.enumValue;
    if (state.get(field) === 'active') {
      report(uriOf(field), field.locations[0], DiagnosticId.CS0110, [field.toDisplayString()]);
      state.set(field, 'done');
      field.enumValue = null;
      field.constantValue = null;
      return null;
    }
    state.set(field, 'active');
    let value = null;
    const init = field.syntax.equalsValue?.value;
    if (init) {
      const bound = evaluate(init, field.scope, field);
      if (bound.errors) value = null;
      else if (!bound.constant) {
        report(uriOf(field), init, DiagnosticId.CS0133, [field.toDisplayString()]);
      } else {
        const c = bound.constant,
          sameEnum = c.isEnum && bound.type?.equals(enumType);
        if (!c.isIntegral || (c.isEnum && !sameEnum)) {
          report(uriOf(field), init, DiagnosticId.CS0266, [
            bound.type?.toDisplayString() ?? c.typeName,
            core.enumUnderlying(enumType).toDisplayString(),
          ]);
        } else {
          const v = c.bigint,
            fromKind = c.type;
          // An int constant narrows implicitly when in range; other types need an implicit numeric conversion.
          if (v < lo || v > hi) report(uriOf(field), init, DiagnosticId.CS0031, [String(v), kind]);
          else if (!sameEnum && fromKind !== kind && fromKind !== 'int' && !implicitTo(fromKind, kind))
            report(uriOf(field), init, DiagnosticId.CS0266, [fromKind, kind]);
          else value = v;
        }
      }
    } else {
      const index = fields.indexOf(field);
      if (index === 0) value = 0n;
      else {
        const previous = valueOf(fields[index - 1]);
        if (previous !== null) {
          if (previous + 1n > hi) {
            report(uriOf(field), field.locations[0], DiagnosticId.CS0543, [field.toDisplayString()]);
          } else value = previous + 1n;
        }
      }
    }
    field.enumValue = value;
    field.constantValue = value === null ? null : ConstantValue.integral(kind, value, enumType);
    field.hasConstantValue = value !== null;
    state.set(field, 'done');
    return value;
  };
  for (const f of fields) valueOf(f);
  return fields;
}
const widening = {
  sbyte: ['short', 'int', 'long'],
  byte: ['short', 'ushort', 'int', 'uint', 'long', 'ulong'],
  short: ['int', 'long'],
  ushort: ['int', 'uint', 'long', 'ulong'],
  int: ['long'],
  uint: ['long', 'ulong'],
  char: ['ushort', 'int', 'uint', 'long', 'ulong'],
};
const implicitTo = (from, to) => !!widening[from]?.includes(to);
/** The enum constant for a member, as the constant folder represents it. */
export function enumConstant(field) {
  return field.constantValue ?? null;
}
/** Folds `left op right` for enum operands with the enum rules (E+U, E-E, E&E, comparisons); null when not constant. */
export function foldEnumBinary(operator, left, right, context) {
  return foldBinary(operator, left, right, context);
}
/** Converts a constant to an enum type (the explicit numeric-to-enum conversion, or the implicit one from literal 0). */
export function convertConstantToEnum(constant, enumType, core, context) {
  const r = foldConversion(
    constant.isEnum ? new ConstantValue(constant.type, constant.value) : constant,
    enumUnderlyingKind(enumType, core),
    context,
  );
  if (!r || r.error) return r;
  return ConstantValue.integral(r.type, r.bigint, enumType);
}
/** The name(s) a value prints as with Enum.ToString(): the member with that value, a flags combination, or the number. */
export function enumToString(enumType, value, { isFlags = false } = {}) {
  const v = BigInt(value),
    fields = enumType.getMembers().filter(m => m.isEnumMember && m.enumValue !== null && m.enumValue !== undefined),
    exact = fields.find(f => f.enumValue === v);
  if (exact) return exact.name;
  if (!isFlags || v === 0n) return String(v);
  let rest = v;
  const names = [];
  for (const f of [...fields].sort((a, b) => (a.enumValue < b.enumValue ? 1 : -1))) {
    if (f.enumValue !== 0n && (rest & f.enumValue) === f.enumValue) {
      names.unshift(f.name);
      rest &= ~f.enumValue;
    }
  }
  return rest === 0n && names.length ? names.join(', ') : String(v);
}
