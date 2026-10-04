/**
 * Unary and binary operator resolution (SF-A02-T06.5, C# spec 12.4.3-12.4.6): user-defined operators first (declared
 * in the operand types and their base classes, lifted over nullable operands), then the predefined operator tables -
 * numeric (through binary numeric promotion), bool, string concatenation, enumeration, delegate and reference
 * equality. `&&`/`||` on user types need `operator &`/`|` plus `operator true`/`false`; compound assignment and
 * `++`/`--` reuse the binary/unary result and convert back to the operand type.
 *
 * Results: `{kind:'builtin',family,leftType,rightType,resultType,isLifted}` |
 *          `{kind:'user',method,resultType,isLifted,conversions}` | `{kind:'error',code,args}`.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { withCheckedOperators, checkedOperatorName } from './checked-operators.js';
import { TypeKind, SymbolKind } from '../symbols/types.js';
import { tupleElements } from '../symbols/tuple-elements.js';
import { binaryNumericPromotion, unaryNumericPromotion, shiftPromotion, isIntegralKind, isNumericKind } from '../conversions/numeric.js';
import { isNullableType, stripNullable } from '../conversions/nullable.js';
import { baseTypeChain } from '../symbols/substitution.js';
import { hasExplicitReferenceConversion } from '../conversions/reference.js';
import { argumentDisplay } from './resolution.js';
import { resolvePredefinedOperator } from './predefined-operators.js';
import { interfaceOperators, withoutHiddenInterfaceOperators } from './interface-operators.js';
import { pointerBinaryOperator, pointerUnaryOperator } from './pointer-operators.js';

export const binaryOperatorNames = Object.freeze({
  '+': 'op_Addition',
  '-': 'op_Subtraction',
  '*': 'op_Multiply',
  '/': 'op_Division',
  '%': 'op_Modulus',
  '&': 'op_BitwiseAnd',
  '|': 'op_BitwiseOr',
  '^': 'op_ExclusiveOr',
  '<<': 'op_LeftShift',
  '>>': 'op_RightShift',
  '>>>': 'op_UnsignedRightShift',
  '==': 'op_Equality',
  '!=': 'op_Inequality',
  '<': 'op_LessThan',
  '>': 'op_GreaterThan',
  '<=': 'op_LessThanOrEqual',
  '>=': 'op_GreaterThanOrEqual',
});
export const unaryOperatorNames = Object.freeze({
  '+': 'op_UnaryPlus',
  '-': 'op_UnaryNegation',
  '!': 'op_LogicalNot',
  '~': 'op_OnesComplement',
  '++': 'op_Increment',
  '--': 'op_Decrement',
  true: 'op_True',
  false: 'op_False',
});
/** Operators that must be declared in pairs (CS0216). */
export const pairedOperators = Object.freeze({
  op_Equality: 'op_Inequality',
  op_Inequality: 'op_Equality',
  op_LessThan: 'op_GreaterThan',
  op_GreaterThan: 'op_LessThan',
  op_LessThanOrEqual: 'op_GreaterThanOrEqual',
  op_GreaterThanOrEqual: 'op_LessThanOrEqual',
  op_True: 'op_False',
  op_False: 'op_True',
});
const comparisons = new Set(['==', '!=', '<', '>', '<=', '>=']),
  equality = new Set(['==', '!=']),
  arithmetic = new Set(['+', '-', '*', '/', '%']),
  bitwise = new Set(['&', '|', '^']),
  shifts = new Set(['<<', '>>', '>>>']);
const builtin = (family, leftType, rightType, resultType, isLifted = false, extra = {}) => ({
  kind: 'builtin',
  family,
  leftType,
  rightType,
  resultType,
  isLifted,
  ...extra,
});
const isNullLiteral = e => e.literal === 'null';
const isEnum = t => !!t && t.typeKind === TypeKind.Enum;

export class OperatorResolver {
  /** @param conversions Conversions  @param core CoreTypes  @param overloads OverloadResolver */
  constructor(conversions, core, overloads) {
    this.conversions = conversions;
    this.core = core;
    this.overloads = overloads;
  }
  kind(type) {
    return type ? this.conversions.kindOf(type) : null;
  }
  typeOfKind(kind) {
    return this.core.keyword(kind);
  }
  /** User-defined operator methods named `name` declared in `type` (nullable stripped) and its base classes. */
  declared(type, name) {
    const t = type ? stripNullable(type) : null;
    if (!t || (t.typeKind === TypeKind.TypeParameter && !t.constraintTypes.length)) return [];
    const out = [];
    for (const b of t.typeKind === TypeKind.Interface ? [t] : baseTypeChain(t, this.core)) {
      if (b.specialType && b.specialType !== 'System_Decimal' && b.typeKind !== TypeKind.Interface) continue;
      for (const m of b.getMembers(name)) if (m.kind === SymbolKind.Method && m.isStatic) out.push(m);
      if (out.length) break;
    }
    // C# 11: a type parameter also has the static abstract operators of its constraint interfaces.
    return out.length ? out : interfaceOperators(t, name, this.core);
  }
  userDefined(name, operands, parameterCount, isChecked = false) {
    const candidates = [];
    for (const o of operands) {
      // C# 11: in a checked context `operator checked` replaces the unchecked operator with the same operands.
      const declared = isChecked
        ? withCheckedOperators(this.declared(o.type, name), this.declared(o.type, checkedOperatorName(name)))
        : this.declared(o.type, name);
      for (const m of declared) if (m.parameters.length === parameterCount && !candidates.includes(m)) candidates.push(m);
    }
    if (!candidates.length) return null;
    const applies = m => this.overloads.resolve([m], operands, { keepBaseCandidates: true }).succeeded,
      visible = withoutHiddenInterfaceOperators(candidates, applies, this.core);
    const direct = this.overloads.resolve(visible, operands, { keepBaseCandidates: true });
    if (direct.succeeded)
      return {
        kind: 'user',
        method: direct.method,
        resultType: direct.method.returnType,
        isLifted: false,
        conversions: direct.conversions,
      };
    if (direct.error.code === DiagnosticId.CS0121) return { kind: 'error', code: DiagnosticId.CS0034, ambiguous: true };
    // Lifted form: non-nullable value parameters, nullable operands; null in gives null out (or false for comparisons).
    if (operands.some(o => (o.type && isNullableType(o.type)) || isNullLiteral(o))) {
      const liftable = candidates.filter(
        m => m.parameters.every(p => p.type.isValueType === true && !isNullableType(p.type)) && m.returnType.isValueType === true,
      );
      const stripped = operands.map(o =>
        isNullLiteral(o) ? null : { ...o, type: o.type ? stripNullable(o.type) : o.type, constantValue: null },
      );
      const usable = liftable.filter(m =>
        stripped.every((o, i) => o === null || this.conversions.classifyFromExpression(o, m.parameters[i].type).isImplicit),
      );
      if (usable.length === 1 || (usable.length > 1 && stripped.every(o => o))) {
        const lifted =
          usable.length === 1
            ? { succeeded: true, method: usable[0] }
            : this.overloads.resolve(usable, stripped, { keepBaseCandidates: true });
        if (lifted.succeeded) {
          const op = Object.keys(binaryOperatorNames).find(k => binaryOperatorNames[k] === name);
          return {
            kind: 'user',
            method: lifted.method,
            isLifted: true,
            resultType: comparisons.has(op) ? lifted.method.returnType : this.core.nullableOf(lifted.method.returnType),
            conversions: null,
          };
        }
      }
    }
    return { kind: 'inapplicable' };
  }
  /** Binary operator resolution for bound operands. */
  binary(operator, left, right, { isChecked = false } = {}) {
    if (left.type?.isErrorType() || right.type?.isErrorType()) return { kind: 'error', suppressed: true };
    const pointer = pointerBinaryOperator(operator, left, right, this.core, (expression, kind) => {
      const type = this.typeOfKind(kind);
      return this.conversions.classifyFromExpression(expression, type).isImplicit ? type : null;
    });
    if (pointer) return pointer;
    const name = binaryOperatorNames[operator];
    if (name) {
      const user = this.userDefined(name, [left, right], 2, isChecked);
      if (user?.kind === 'user') return user;
      if (user?.kind === 'error') return this.error(user.code, operator, left, right);
    }
    return this.builtinBinary(operator, left, right) ?? this.throughConversions(operator, [left, right]) ?? this.error(DiagnosticId.CS0019, operator, left, right);
  }
  /** A predefined operator applied through user-defined implicit conversions of the operands, or null. */
  throughConversions(operator, operands) {
    const found = resolvePredefinedOperator(this, operator, operands);
    if (!found?.ambiguous) return found;
    const code = operands.length === 1 ? DiagnosticId.CS0035 : DiagnosticId.CS0034;
    return { kind: 'error', code, args: [operator, ...operands.map(argumentDisplay)] };
  }
  error(code, operator, left, right) {
    return { kind: 'error', code, args: [operator, argumentDisplay(left), argumentDisplay(right)] };
  }
  builtinBinary(operator, left, right) {
    const core = this.core,
      lt = left.type ?? null,
      rt = right.type ?? null;
    if (operator === '&&' || operator === '||') {
      if (lt?.specialType === 'System_Boolean' && rt?.specialType === 'System_Boolean')
        return builtin('bool', core.bool, core.bool, core.bool);
      return this.userLogical(operator, left, right);
    }
    // Typeless operands: null == null, and null against a reference or nullable type.
    if (!lt || !rt) {
      const typed = lt ?? rt,
        other = lt ? right : left;
      if (!typed) {
        return equality.has(operator) && isNullLiteral(left) && isNullLiteral(right)
          ? builtin('object', core.object, core.object, core.bool)
          : null;
      }
      if (isNullLiteral(other)) {
        if (equality.has(operator)) {
          if (isNullableType(typed)) return builtin('nullable', typed, typed, core.bool, true);
          if (typed.isReferenceType === true || (typed.typeKind === TypeKind.TypeParameter && typed.isValueType !== true))
            return builtin('object', core.object, core.object, core.bool);
          return null;
        }
        if (operator === '+' && typed.specialType === 'System_String')
          return builtin('string', lt ?? core.object, rt ?? core.object, core.string);
        // `x + null` with a nullable or numeric x binds to the lifted operator and is always null (warning CS0458 in Roslyn).
        const k = this.kind(stripNullable(typed));
        if (k && (arithmetic.has(operator) || comparisons.has(operator) || bitwise.has(operator))) {
          const p = binaryNumericPromotion(k, k);
          if (p) {
            const t = core.nullableOf(this.typeOfKind(p));
            return builtin('numeric', t, t, comparisons.has(operator) ? core.bool : t, true, { alwaysNull: true });
          }
        }
        return null;
      }
      if (other.literal === 'default') {
        const r = this.builtinBinary(
          operator,
          lt ? left : { ...left, type: typed, literal: null },
          rt ? right : { ...right, type: typed, literal: null },
        );
        return r;
      }
      return null;
    }
    if (operator === '+' && (lt.specialType === 'System_String' || rt.specialType === 'System_String')) {
      if (lt.specialType === 'System_Void' || rt.specialType === 'System_Void') return null;
      return builtin(
        'string',
        lt.specialType === 'System_String' ? core.string : core.object,
        rt.specialType === 'System_String' ? core.string : core.object,
        core.string,
      );
    }
    const l0 = stripNullable(lt),
      r0 = stripNullable(rt),
      lifted = l0 !== lt || r0 !== rt,
      wrap = t => (lifted ? core.nullableOf(t) : t);
    // bool
    if (l0.specialType === 'System_Boolean' && r0.specialType === 'System_Boolean' && (bitwise.has(operator) || equality.has(operator)))
      return builtin('bool', wrap(core.bool), wrap(core.bool), equality.has(operator) ? core.bool : wrap(core.bool), lifted);
    // enumerations
    if (isEnum(l0) || isEnum(r0)) {
      const e = this.enumOperator(operator, left, right, l0, r0);
      if (e)
        return {
          ...e,
          isLifted: lifted,
          leftType: lifted ? core.nullableOf(e.leftType) : e.leftType,
          rightType: lifted ? core.nullableOf(e.rightType) : e.rightType,
          resultType: e.resultType === core.bool ? core.bool : wrap(e.resultType),
        };
    }
    // numeric
    const lk = this.kind(l0),
      rk = this.kind(r0);
    if (lk && rk) {
      if (shifts.has(operator)) {
        const p = shiftPromotion(lk);
        if (!p || !this.conversions.classifyFromExpression({ ...right, type: r0 }, core.int).isImplicit) return null;
        const t = this.typeOfKind(p);
        return builtin('shift', wrap(t), lifted ? core.nullableOf(core.int) : core.int, wrap(t), lifted);
      }
      if (arithmetic.has(operator) || comparisons.has(operator) || bitwise.has(operator)) {
        const constant = e =>
          e.constantValue && e.constantValue.isIntegral && !e.constantValue.isEnum && e.constantValue.type !== 'char'
            ? e.constantValue.bigint
            : undefined;
        const p = binaryNumericPromotion(lk, rk, { leftConstant: constant(left), rightConstant: constant(right) });
        if (!p)
          return {
            kind: 'error',
            code: lk === 'decimal' || rk === 'decimal' ? DiagnosticId.CS0019 : DiagnosticId.CS0034,
            args: [operator, argumentDisplay(left), argumentDisplay(right)],
          };
        if (bitwise.has(operator) && !isIntegralKind(p)) return null;
        const t = this.typeOfKind(p);
        return builtin('numeric', wrap(t), wrap(t), comparisons.has(operator) ? core.bool : wrap(t), lifted, { operandKind: p });
      }
    }
    // delegates
    if (
      lt.typeKind === TypeKind.Delegate &&
      (operator === '+' || operator === '-') &&
      this.conversions.classifyFromExpression(right, lt).isImplicit
    )
      return builtin('delegate', lt, lt, lt);
    if (rt.typeKind === TypeKind.Delegate && operator === '+' && this.conversions.classifyFromExpression(left, rt).isImplicit)
      return builtin('delegate', rt, rt, rt);
    // reference equality
    if (equality.has(operator)) {
      const refLike = t => t.isReferenceType === true || (t.typeKind === TypeKind.TypeParameter && t.isValueType !== true);
      if (
        refLike(lt) &&
        refLike(rt) &&
        (lt.equals(rt) ||
          this.conversions.hasIdentityOrReference(lt, rt) ||
          this.conversions.hasIdentityOrReference(rt, lt) ||
          (hasExplicitReferenceConversion(lt, rt, core) &&
            (lt.typeKind === TypeKind.Interface ||
              rt.typeKind === TypeKind.Interface ||
              lt.typeKind === TypeKind.TypeParameter ||
              rt.typeKind === TypeKind.TypeParameter)))
      )
        return builtin('object', core.object, core.object, core.bool);
      // Tuples compare element-wise (C# 7.3).
      if (lt.isTupleType && rt.isTupleType && tupleElements(lt).length === tupleElements(rt).length)
        return builtin('tuple', lt, rt, core.bool);
    }
    return null;
  }
  enumOperator(operator, left, right, l0, r0) {
    const core = this.core,
      underlying = t => core.enumUnderlying(t),
      convertsTo = (e, t) => this.conversions.classifyFromExpression({ ...e, type: e.type ? stripNullable(e.type) : e.type }, t).isImplicit;
    const le = isEnum(l0),
      re = isEnum(r0);
    if (le && re) {
      if (!l0.equals(r0)) return null;
      if (comparisons.has(operator)) return builtin('enum', l0, l0, core.bool);
      if (bitwise.has(operator)) return builtin('enum', l0, l0, l0);
      if (operator === '-') return builtin('enum', l0, l0, underlying(l0));
      return null;
    }
    const e = le ? l0 : r0,
      other = le ? right : left,
      u = underlying(e);
    // The other operand converts to the enum (literal 0) for comparisons and bitwise operators.
    if ((comparisons.has(operator) || bitwise.has(operator)) && convertsTo(other, e))
      return builtin('enum', e, e, comparisons.has(operator) ? core.bool : e);
    if (operator === '+' && convertsTo(other, u)) return builtin('enum', le ? e : u, le ? u : e, e);
    if (operator === '-' && le && convertsTo(other, u)) return builtin('enum', e, u, e);
    return null;
  }
  /** `&&` / `||` on user types: operator & / | returning the operand type, plus operator true/false (CS0217, CS0218). */
  userLogical(operator, left, right) {
    const user = this.userDefined(operator === '&&' ? 'op_BitwiseAnd' : 'op_BitwiseOr', [left, right], 2);
    if (!user || user.kind !== 'user') return null;
    const m = user.method,
      t = m.returnType;
    if (!m.parameters.every(p => p.type.equals(t))) return { kind: 'error', code: DiagnosticId.CS0217, args: [m.toDisplayString()] };
    const which = operator === '&&' ? 'op_False' : 'op_True',
      test = this.declared(t, which).find(x => x.parameters.length === 1);
    if (!test) return { kind: 'error', code: DiagnosticId.CS0218, args: [m.toDisplayString(), t.toDisplayString()] };
    return { ...user, isLogical: true, shortCircuitOperator: test };
  }
  /** Unary operator resolution: `+ - ! ~ ++ --` (and `true`/`false` for conditions). */
  unary(operator, operand, { isChecked = false } = {}) {
    const core = this.core,
      type = operand.type;
    if (type?.isErrorType()) return { kind: 'error', suppressed: true };
    const fail = () => ({ kind: 'error', code: DiagnosticId.CS0023, args: [operator, argumentDisplay(operand)] });
    if (!type) return fail();
    const pointer = pointerUnaryOperator(operator, operand);
    if (pointer) return pointer;
    const name = unaryOperatorNames[operator];
    if (name) {
      const user = this.userDefined(name, [operand], 1, isChecked);
      if (user?.kind === 'user') return user;
      if (user?.kind === 'error') return { kind: 'error', code: DiagnosticId.CS0035, args: [operator, argumentDisplay(operand)] };
    }
    const t0 = stripNullable(type),
      lifted = t0 !== type,
      wrap = t => (lifted ? core.nullableOf(t) : t);
    const converted = this.throughConversions(operator, [operand]);
    if (converted) return converted;
    if (operator === '!') return t0.specialType === 'System_Boolean' ? builtin('bool', type, null, type, lifted) : fail();
    if (isEnum(t0)) {
      if (operator === '~' || operator === '++' || operator === '--') return builtin('enum', type, null, type, lifted);
      return fail();
    }
    const k = this.kind(t0);
    if (!k) return fail();
    if (operator === '++' || operator === '--') return builtin('numeric', type, null, type, lifted, { operandKind: k });
    // `-` applied to the literal 2147483648 / 9223372036854775808 is handled by the caller (constant folding).
    const p = unaryNumericPromotion(operator, k);
    if (!p)
      return operator === '-' && (k === 'ulong' || k === 'nuint')
        ? { kind: 'error', code: DiagnosticId.CS0023, args: [operator, argumentDisplay(operand)] }
        : fail();
    const t = wrap(this.typeOfKind(p));
    return builtin('numeric', t, null, t, lifted, { operandKind: p });
  }
  /** `operator true` of a type, for conditions on user types (`if (x)`), or null. */
  trueOperator(type) {
    return this.declared(type, 'op_True').find(m => m.parameters.length === 1) ?? null;
  }
}
export { isNumericKind };
