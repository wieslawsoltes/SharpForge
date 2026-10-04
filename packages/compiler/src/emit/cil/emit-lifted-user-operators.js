/**
 * User-defined operators over nullable values (SF-A02-T30), the lifted forms the language defines over an operator
 * declared for `T` (C# spec 10.6.2, 12.4.8):
 *
 *   (U?)x, (U)x     a conversion `T -> U` applied to a `T?`: null stays null, or `Value` is read (and throws)
 *   x++             over a `T?`: null stays null
 *   x < y, x == y   the operator is called only when both operands have a value
 *
 * The members of `Nullable<T>` and the temporaries come from emit-nullable.js, which this mixin sits on.
 */
import { isReference } from './type-facts.js';

const relational = new Set(['<', '>', '<=', '>=']);

/** Class mixin over NullableEmission: lifted user-defined conversions, increments and comparisons. */
export const LiftedUserOperatorEmission = Base =>
  class extends Base {
    /**
     * A user-defined conversion around nullable values (C# spec 10.6.2): `S?` to `T?` through `S -> T` is lifted
     * (null stays null), `S?` to a `T` that cannot be null reads `Value`, and `S` to `T?` wraps the result.
     */
    userDefinedConversion(node) {
      const method = node.conversion.method ?? node.method,
        from = node.operand.type,
        to = node.type,
        parameterType = method?.parameters[0].type,
        liftsOperand = !!from?.isNullableValueType && !parameterType?.isNullableValueType,
        wrapsResult = to.isNullableValueType && !!method && !method.returnType.isNullableValueType && !isReference(method.returnType);
      if (!method || (!liftsOperand && !wrapsResult)) return super.userDefinedConversion(node);
      const il = this.il,
        convert = operandType => {
          this.implicitStandardConversion(operandType, parameterType, node.syntax);
          this.callMethod(method, { isStatic: true, syntax: node.syntax });
          if (!wrapsResult) return this.implicitStandardConversion(method.returnType, to, node.syntax);
          this.implicitStandardConversion(method.returnType, to.nullableUnderlyingType, node.syntax);
          return this.wrapNullable(to);
        };
      if (!liftsOperand) {
        this.expression(node.operand);
        return convert(from);
      }
      const slot = this.nullableOperand(node.operand);
      if (!wrapsResult) {
        this.nullableCall(slot, from, 'get_Value');
        return convert(from.nullableUnderlyingType);
      }
      const absent = il.newLabel(),
        end = il.newLabel();
      this.nullableCall(slot, from, 'get_HasValue');
      il.emit('brfalse', absent);
      this.nullableCall(slot, from, 'GetValueOrDefault');
      convert(from.nullableUnderlyingType);
      il.emit('br', end);
      il.mark(absent);
      this.defaultValue(to);
      il.mark(end);
      return undefined;
    }
    /** `x++` over a `T?` with a user-defined operator on `T` is lifted: null stays null. */
    userIncrement(node, type) {
      if (!type?.isNullableValueType || node.method.parameters[0].type.isNullableValueType) return super.userIncrement(node, type);
      const il = this.il,
        slot = this.temp(type),
        absent = il.newLabel(),
        end = il.newLabel();
      il.emit('stloc', slot);
      this.nullableCall(slot, type, 'get_HasValue');
      il.emit('brfalse', absent);
      this.nullableCall(slot, type, 'GetValueOrDefault');
      this.callMethod(node.method, { syntax: node.syntax });
      this.wrapNullable(type);
      il.emit('br', end);
      il.mark(absent);
      this.defaultValue(type);
      il.mark(end);
      return undefined;
    }
    /**
     * A lifted comparison with a user-defined operator calls the operator only when both operands have a value
     * (it may throw or have effects): `<` and its kin are false otherwise; `==` is true and `!=` false when both
     * are absent, and the reverse when only one is.
     */
    liftedUserComparison(node, operands, hasLeft, hasRight) {
      const il = this.il,
        isEquality = !relational.has(node.operator),
        differ = il.newLabel(),
        absent = il.newLabel(),
        end = il.newLabel();
      if (isEquality) {
        hasLeft();
        hasRight();
        il.emit('bne.un', differ);
        hasLeft();
        il.emit('brfalse', absent);
      } else {
        hasLeft();
        hasRight();
        il.emit('and').emit('brfalse', absent);
      }
      operands();
      il.emit('br', end);
      il.mark(absent);
      il.emit('ldc.i4', isEquality && node.operator === '==' ? 1 : 0);
      if (isEquality) {
        il.emit('br', end);
        il.mark(differ);
        il.emit('ldc.i4', node.operator === '!=' ? 1 : 0);
      }
      il.mark(end);
      return undefined;
    }
  };
