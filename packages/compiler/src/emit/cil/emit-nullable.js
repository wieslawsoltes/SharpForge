/**
 * `Nullable<T>` and the null operators (SF-A02-T30): conversions to and from `T?`, lifted operators, `??`, `??=`,
 * `?.` and tests of a nullable value.
 *
 * A nullable value is the framework struct `System.Nullable<T>`; its members are named on the constructed type with
 * the signature of the definition (`!0 GetValueOrDefault()`), and called on the address of a variable.
 *
 *   a + b          a.HasValue & b.HasValue ? new T?(a.GetValueOrDefault() + b.GetValueOrDefault()) : default
 *   a < b          a.GetValueOrDefault() < b.GetValueOrDefault() & (a.HasValue & b.HasValue)
 *   a == b         a.GetValueOrDefault() == b.GetValueOrDefault() & a.HasValue == b.HasValue
 *   a ?? b         a.HasValue ? a.GetValueOrDefault() : b
 *   r?.M           r == null ? default : r.M      (wrapped in `T?` when M is a value)
 */
import { isReference, isVoid, primitiveOf } from './type-facts.js';

const relational = new Set(['<', '>', '<=', '>=']);
const isNullOperand = node => node.literal === 'null' || node.conversion?.kind === 'NullLiteral' || node.constantValue?.isNull === true;

/** Class mixin: nullable value types and null operators. */
export const NullableEmission = Base =>
  class extends Base {
    /** MemberRef of a member of the constructed `Nullable<T>`, named by the signature of the definition. */
    nullableMember(type, name) {
      const definition = this.core.nullable,
        parameter = definition.typeParameters[0],
        shapes = {
          get_HasValue: { isStatic: false, returnType: this.core.bool, parameters: [] },
          GetValueOrDefault: { isStatic: false, returnType: parameter, parameters: [] },
          get_Value: { isStatic: false, returnType: parameter, parameters: [] },
          '.ctor': { isStatic: false, returnType: this.core.void, parameters: [{ type: parameter }] },
        };
      return this.tokens.external(type, name, shapes[name]);
    }
    /** Calls a parameterless member of the nullable in `slot`. */
    nullableCall(slot, type, name) {
      this.il.emit('ldloca', slot).emit('call', this.nullableMember(type, name), { pops: 1, pushes: 1 });
    }
    /** Wraps the value on the stack: `new T?(value)`. */
    wrapNullable(type) {
      this.il.emit('newobj', this.nullableMember(type, '.ctor'), { pops: 1, pushes: 1 });
    }
    /** Evaluates a nullable operand into a temporary and returns its slot. */
    nullableOperand(node) {
      const slot = this.temp(node.type);
      this.expression(node);
      this.il.emit('stloc', slot);
      return slot;
    }
    nullableConversion(node) {
      const from = node.operand.type,
        to = node.type;
      if (!to.isNullableValueType) {
        // `(T)nullable`: `Value` throws when there is none.
        this.nullableCall(this.nullableOperand(node.operand), from, 'get_Value');
        return this.underlyingConversion(from.nullableUnderlyingType, to, node);
      }
      if (!from?.isNullableValueType) {
        this.expression(node.operand);
        this.underlyingConversion(from, to.nullableUnderlyingType, node);
        return this.wrapNullable(to);
      }
      // `S?` to `T?`: convert the value when there is one.
      const il = this.il,
        slot = this.nullableOperand(node.operand),
        absent = il.newLabel(),
        end = il.newLabel();
      this.nullableCall(slot, from, 'get_HasValue');
      il.emit('brfalse', absent);
      this.nullableCall(slot, from, 'GetValueOrDefault');
      this.underlyingConversion(from.nullableUnderlyingType, to.nullableUnderlyingType, node);
      this.wrapNullable(to);
      il.emit('br', end);
      il.mark(absent);
      this.defaultValue(to);
      il.mark(end);
      return undefined;
    }
    /** The conversion between the underlying types of a nullable conversion. */
    underlyingConversion(from, to, node) {
      if (!from || !to || from.equals(to)) return undefined;
      const underlying = node.conversion?.underlying;
      if (underlying?.method) {
        this.callMethod(underlying.method, { syntax: node.syntax });
        return undefined;
      }
      if (primitiveOf(from) && primitiveOf(to)) return this.numericConversion(from, to, { isChecked: !!node.isChecked, syntax: node.syntax });
      return this.implicitStandardConversion(from, to, node.syntax);
    }
    liftedUnary(node) {
      const il = this.il,
        type = node.operand.type,
        slot = this.nullableOperand(node.operand),
        absent = il.newLabel(),
        end = il.newLabel(),
        underlying = type.nullableUnderlyingType;
      this.nullableCall(slot, type, 'get_HasValue');
      il.emit('brfalse', absent);
      // The operator over the value: the operand node stands for `GetValueOrDefault()` of the temporary.
      const value = { ...node.operand, type: underlying, constantValue: null, hasErrors: false };
      this.substitutions.set(value, { value: () => this.nullableCall(slot, type, 'GetValueOrDefault') });
      try {
        this.exprUnary({ ...node, isLifted: false, operand: value, type: node.type.nullableUnderlyingType ?? node.type });
      } finally {
        this.substitutions.delete(value);
      }
      this.wrapNullable(node.type);
      il.emit('br', end);
      il.mark(absent);
      this.defaultValue(node.type);
      il.mark(end);
    }
    liftedBinary(node) {
      const { left, right, operator } = node;
      if (operator === '==' || operator === '!=') {
        if (isNullOperand(right)) return this.nullTest(left, operator === '==');
        if (isNullOperand(left)) return this.nullTest(right, operator === '==');
      }
      const il = this.il,
        leftSlot = this.liftedOperand(node, 0),
        rightSlot = this.liftedOperand(node, 1),
        // An operand that is not nullable (`price + 1` over a `decimal?`) is always present and is its own value.
        value = (slot, type) => (type?.isNullableValueType ? this.nullableCall(slot, type, 'GetValueOrDefault') : il.emit('ldloc', slot)),
        has = (slot, type) => (type?.isNullableValueType ? this.nullableCall(slot, type, 'get_HasValue') : il.emit('ldc.i4', 1)),
        operands = () => {
          value(leftSlot, left.type);
          value(rightSlot, right.type);
          this.underlyingOperator(node);
        };
      if (node.method && (relational.has(operator) || operator === '==' || operator === '!=')) {
        return this.liftedUserComparison(node, operands, () => has(leftSlot, left.type), () => has(rightSlot, right.type));
      }
      if (operator === '==' || operator === '!=') {
        // Equal when both have the same value and the same presence (two absent values hold the same default).
        this.withOperator(node, '==', operands);
        has(leftSlot, left.type);
        has(rightSlot, right.type);
        il.emit('ceq').emit('and');
        if (operator === '!=') il.emit('ldc.i4', 0).emit('ceq');
        return undefined;
      }
      if (relational.has(operator)) {
        operands();
        has(leftSlot, left.type);
        has(rightSlot, right.type);
        return il.emit('and').emit('and');
      }
      const isBool = node.type?.nullableUnderlyingType?.specialType === 'System_Boolean';
      if ((operator === '&' || operator === '|') && isBool && !node.method) {
        return this.liftedLogical(node, [leftSlot, rightSlot], { value, has });
      }
      const absent = il.newLabel(),
        end = il.newLabel();
      has(leftSlot, left.type);
      has(rightSlot, right.type);
      il.emit('and').emit('brfalse', absent);
      operands();
      this.wrapNullable(node.type);
      il.emit('br', end);
      il.mark(absent);
      this.defaultValue(node.type);
      il.mark(end);
      return undefined;
    }
    /**
     * `x & y` and `x | y` over `bool?` are three-valued (C# spec 12.13.5), not lifted: an operand that decides the
     * result (`false` for `&`, `true` for `|`) wins over a null one. With D the deciding value:
     *   left is D -> left;  right is D -> right;  left has a value -> right;  otherwise -> left (null)
     * @param {number[]} slots the locals of the two operands  @param {{value, has}} read pushes an operand's value or presence
     */
    liftedLogical(node, slots, read) {
      const il = this.il,
        types = [node.left.type, node.right.type],
        useLeft = il.newLabel(),
        useRight = il.newLabel(),
        end = il.newLabel(),
        isDeciding = index => {
          read.value(slots[index], types[index]);
          if (node.operator === '|') return;
          // `false` decides `&`: a value that is present and not true.
          il.emit('ldc.i4', 0).emit('ceq');
          read.has(slots[index], types[index]);
          il.emit('and');
        },
        push = index => {
          il.emit('ldloc', slots[index]);
          if (!types[index]?.isNullableValueType) this.wrapNullable(node.type);
        };
      isDeciding(0);
      il.emit('brtrue', useLeft);
      isDeciding(1);
      il.emit('brtrue', useRight);
      read.has(slots[0], types[0]);
      il.emit('brtrue', useRight);
      il.mark(useLeft);
      push(0);
      il.emit('br', end);
      il.mark(useRight);
      push(1);
      il.mark(end);
      return undefined;
    }
    /**
     * Evaluates one operand of a lifted binary operator into a local and returns the local: a nullable operand as it
     * is, any other operand converted to the type the operator takes (the parameter of a user-defined operator).
     */
    liftedOperand(node, index) {
      const operand = index === 0 ? node.left : node.right;
      if (operand.type?.isNullableValueType || !operand.type) return this.nullableOperand(operand);
      const wanted = node.method?.parameters[index]?.type ?? operand.type,
        slot = this.temp(wanted);
      this.expression(operand);
      this.implicitStandardConversion(operand.type, wanted, node.syntax);
      this.il.emit('stloc', slot);
      return slot;
    }
    withOperator(node, operator, emitOperands) {
      const saved = node.operator;
      node.operator = operator;
      try {
        emitOperands();
      } finally {
        node.operator = saved;
      }
    }
    /** The operator over the underlying values that are on the stack. */
    underlyingOperator(node) {
      const underlying = type => (type?.isNullableValueType ? type.nullableUnderlyingType : type);
      if (node.method) return this.callMethod(node.method, { syntax: node.syntax });
      return this.binaryInstruction({ ...node, left: { type: underlying(node.left.type) }, right: { type: underlying(node.right.type) } });
    }
    /** A type pattern over a nullable value matches its value: `x is int v` is `x.HasValue` and `v = x.GetValueOrDefault()`. */
    typeTest(type, input, fail, store) {
      if (!input.type?.isNullableValueType) return super.typeTest(type, input, fail, store);
      const il = this.il,
        underlying = input.type.nullableUnderlyingType;
      if (!underlying.equals(type) && !isReference(type)) return il.emit('br', fail);
      this.nullableCall(input.slot, input.type, 'get_HasValue');
      il.emit('brfalse', fail);
      if (!store) return undefined;
      this.nullableCall(input.slot, input.type, 'GetValueOrDefault');
      if (isReference(type)) il.emit('box', this.tokens.type(underlying));
      return store();
    }
    matchConstantPattern(pattern, input, fail) {
      if (!input.type?.isNullableValueType) return super.matchConstantPattern(pattern, input, fail);
      const constant = pattern.value.constantValue;
      this.nullableCall(input.slot, input.type, 'get_HasValue');
      if (!constant || constant.isNull) return this.il.emit('brtrue', fail);
      this.il.emit('brfalse', fail);
      this.nullableCall(input.slot, input.type, 'GetValueOrDefault');
      this.constantValue(constant, pattern.syntax);
      return this.il.emit('ceq').emit('brfalse', fail);
    }
    /** `x is { } v`, `x is (a, b)` over a nullable value: it has a value, and the pattern is matched against that. */
    matchRecursivePattern(pattern, input, fail) {
      if (!input.type?.isNullableValueType || pattern.testedType) return super.matchRecursivePattern(pattern, input, fail);
      return super.matchRecursivePattern(pattern, this.nullableValueInput(input, fail), fail);
    }
    /** The value of a nullable input as an input of its own (`{slot, type}`), or a branch to `fail`; read once per run. */
    nullableValueInput(input, fail) {
      const type = input.type.nullableUnderlyingType,
        read = () => this.nullableCall(input.slot, input.type, 'GetValueOrDefault');
      this.nullableCall(input.slot, input.type, 'get_HasValue');
      this.il.emit('brfalse', fail);
      return { slot: this.readOnce(input.slot, 'nullable:value', type, read), type };
    }
    unboxedInput(input, type, fail) {
      if (!input.type?.isNullableValueType) return super.unboxedInput(input, type, fail);
      this.nullableCall(input.slot, input.type, 'get_HasValue');
      this.il.emit('brfalse', fail);
      return this.nullableCall(input.slot, input.type, 'GetValueOrDefault');
    }
    /** `x is T` over a nullable value is true when it has a value of that type; `x as T?` is a conversion. */
    nullableTypeTest(node) {
      const operandType = node.operand.type;
      if (node.kind === 'Is' && operandType?.isNullableValueType) {
        if (node.outcome === 'never') {
          this.effect(node.operand);
          return this.il.emit('ldc.i4', 0);
        }
        return this.nullableCall(this.nullableOperand(node.operand), operandType, 'get_HasValue');
      }
      if (node.kind === 'As') {
        // `o as int?`: a box of exactly that type, else no value.
        this.expression(node.operand);
        if (operandType && !isReference(operandType)) this.il.emit('box', this.tokens.type(operandType));
        const target = node.targetType ?? node.type;
        return this.il.emit('isinst', this.tokens.type(target)).emit('unbox.any', this.tokens.type(target));
      }
      return this.unsupported('this type test over a nullable value type', node.syntax);
    }
    /** `x == null` / `x != null` over a nullable value: its `HasValue`. */
    nullTest(operand, isNull) {
      this.nullableCall(this.nullableOperand(operand), operand.type, 'get_HasValue');
      if (isNull) this.il.emit('ldc.i4', 0).emit('ceq');
    }
    nullableCoalesce(node) {
      const il = this.il,
        left = node.left,
        type = left.type;
      if (!type?.isNullableValueType) return this.unsupported(`'??' over '${type?.toDisplayString()}'`, node.syntax);
      const slot = this.nullableOperand(left),
        absent = il.newLabel(),
        end = il.newLabel();
      this.nullableCall(slot, type, 'get_HasValue');
      il.emit('brfalse', absent);
      if (node.type.isNullableValueType) il.emit('ldloc', slot);
      else {
        this.nullableCall(slot, type, 'GetValueOrDefault');
        this.implicitStandardConversion(type.nullableUnderlyingType, node.type, node.syntax);
      }
      il.emit('br', end);
      il.mark(absent);
      if (node.right.form === 'throw' || node.right.kind === 'Throw') this.throwExpression(node.right);
      else this.expression(node.right);
      il.mark(end);
      return undefined;
    }
    /** `a ??= b`: assigns when `a` is null; the value of the expression is the resulting `a`. */
    exprCoalesceAssignment(node, isUsed) {
      const il = this.il,
        location = this.location(node.left),
        type = node.left.type,
        end = il.newLabel();
      location.capture();
      if (type.isNullableValueType) return this.nullableCoalesceAssignment(node, location, isUsed);
      location.load();
      if (isUsed) il.emit('dup');
      il.emit('brtrue', end);
      if (isUsed) il.emit('pop');
      location.beginStore();
      this.expression(node.right);
      this.finishStore(location, isUsed);
      il.mark(end);
      return isUsed ? undefined : false;
    }
    nullableCoalesceAssignment(node, location, isUsed) {
      const il = this.il,
        type = node.left.type,
        current = this.temp(type),
        result = isUsed ? this.temp(node.type) : null,
        assign = il.newLabel(),
        end = il.newLabel(),
        yieldsNullable = !!node.type.isNullableValueType;
      location.load();
      il.emit('stloc', current);
      this.nullableCall(current, type, 'get_HasValue');
      il.emit('brfalse', assign);
      if (isUsed) {
        if (yieldsNullable) il.emit('ldloc', current);
        else this.nullableCall(current, type, 'GetValueOrDefault');
        il.emit('stloc', result);
      }
      il.emit('br', end);
      il.mark(assign);
      location.beginStore();
      this.expression(node.right);
      if (isUsed && !yieldsNullable) il.emit('dup').emit('stloc', result);
      if (!node.right.type?.isNullableValueType) this.wrapNullable(type);
      if (isUsed && yieldsNullable) il.emit('dup').emit('stloc', result);
      location.endStore();
      il.mark(end);
      if (isUsed) il.emit('ldloc', result);
      return isUsed ? undefined : false;
    }
    /**
     * `a?.b?.c`: each receiver of the chain is evaluated once and tested; when one is null the whole expression is
     * null (or nothing, as a statement). Only the last access produces the value, wrapped in `T?` when it is a value.
     */
    exprConditionalAccess(node, isUsed) {
      const il = this.il,
        absent = il.newLabel(),
        end = il.newLabel(),
        saved = this.conditionalReceiver;
      let last = node;
      while (last.whenNotNull.kind === 'ConditionalAccess') last = last.whenNotNull;
      const access = last.whenNotNull,
        producesValue = isUsed && !isVoid(access.type);
      try {
        for (let link = node; ; link = link.whenNotNull) {
          this.conditionalLink(link, absent);
          if (link === last) break;
        }
        if (producesValue) this.expression(access);
        else this.effect(access);
      } finally {
        this.conditionalReceiver = saved;
      }
      if (!producesValue) {
        il.mark(absent);
        return false;
      }
      if (node.type.isNullableValueType && !access.type?.isNullableValueType) this.wrapNullable(node.type);
      il.emit('br', end);
      il.mark(absent);
      this.defaultValue(node.type);
      il.mark(end);
      return undefined;
    }
    /** Evaluates the receiver of one `?.` into a temporary, leaves to `absent` when it is null, and makes it the placeholder's value. */
    conditionalLink(link, absent) {
      const il = this.il,
        type = link.receiver.type,
        slot = this.temp(type);
      this.expression(link.receiver);
      il.emit('stloc', slot);
      if (type.isNullableValueType) {
        this.nullableCall(slot, type, 'get_HasValue');
        this.conditionalReceiver = () => this.nullableCall(slot, type, 'GetValueOrDefault');
      } else {
        il.emit('ldloc', slot);
        if (!isReference(type)) il.emit('box', this.tokens.type(type));
        this.conditionalReceiver = () => il.emit('ldloc', slot);
      }
      il.emit('brfalse', absent);
    }
    exprConditionalReceiver(node) {
      if (!this.conditionalReceiver) return this.unsupported('a null-conditional receiver in this position', node.syntax);
      this.conditionalReceiver();
      return undefined;
    }
  };
