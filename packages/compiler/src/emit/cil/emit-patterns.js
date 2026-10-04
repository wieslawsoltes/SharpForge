/**
 * Type tests and patterns (SF-A02-T30): `is`, `as`, `is pattern`, and the test of one pattern against a value.
 *
 * `patternMatch(pattern, input, fail)` emits a test of the value in the temporary `input` (`{slot, type}`): control
 * falls through when the pattern matches and goes to `fail` when it does not. A run-time type test is `isinst`
 * (ECMA-335 III.4.6); a value of a value type is read back from the box with `unbox.any`.
 */
import { SymbolKind, TypeKind } from '../../symbols/types.js';
import { isReference, primitiveOf, needsBox } from './type-facts.js';
import { describeKind } from './unsupported.js';

const isString = type => type?.specialType === 'System_String';
const isTypeParameter = type => type?.typeKind === TypeKind.TypeParameter;

/** Class mixin: type tests and patterns. */
export const PatternEmission = Base =>
  class extends Base {
    /** Evaluates a node into a fresh temporary: `{slot, type}`. */
    spillValue(node) {
      const slot = this.temp(node.type ?? this.core.object);
      this.expression(node);
      this.il.emit('stloc', slot);
      return { slot, type: node.type ?? this.core.object };
    }
    /** Pushes the input as an object reference (a type parameter is boxed; a null reference stays null). */
    pushReference(input) {
      this.il.emit('ldloc', input.slot);
      if (isTypeParameter(input.type)) this.il.emit('box', this.tokens.type(input.type));
    }
    exprIs(node) {
      const il = this.il,
        operandType = node.operand.type;
      if (operandType && !isReference(operandType) && !isTypeParameter(operandType)) {
        // The static type decides for a non-nullable value: the operand is still evaluated.
        if (operandType.isNullableValueType) return this.nullableTypeTest(node);
        this.effect(node.operand);
        return il.emit('ldc.i4', node.outcome === 'never' ? 0 : 1);
      }
      this.expression(node.operand);
      if (isTypeParameter(operandType)) il.emit('box', this.tokens.type(operandType));
      return il.emit('isinst', this.tokens.type(node.testedType)).emit('ldnull').emit('cgt.un');
    }
    exprAs(node) {
      const il = this.il,
        operandType = node.operand.type,
        target = node.targetType ?? node.type;
      if (target.isNullableValueType) return this.nullableTypeTest(node);
      if (operandType?.isNullableValueType) return this.unsupported(`'as' over a nullable value type`, node.syntax);
      this.expression(node.operand);
      if (operandType && needsBox(operandType)) il.emit('box', this.tokens.type(operandType));
      il.emit('isinst', this.tokens.type(target));
      // The verifier types `isinst T` for a type parameter as a box; the value of the expression is a T.
      if (isTypeParameter(target)) il.emit('unbox.any', this.tokens.type(target));
      return undefined;
    }
    nullableTypeTest(node) {
      return this.unsupported('type tests over nullable value types', node.syntax);
    }
    exprIsPattern(node) {
      const il = this.il,
        fail = il.newLabel(),
        end = il.newLabel();
      this.patternMatch(node.pattern, this.spillValue(node.operand), fail);
      il.emit('ldc.i4', 1).emit('br', end);
      il.mark(fail);
      il.emit('ldc.i4', 0);
      il.mark(end);
    }
    /** `if (x is P)` branches on the test directly instead of materializing a boolean. */
    branchOnPattern(node, target, sense) {
      const il = this.il,
        input = this.spillValue(node.operand);
      if (!sense) return this.patternMatch(node.pattern, input, target);
      const fail = il.newLabel();
      this.patternMatch(node.pattern, input, fail);
      il.emit('br', target);
      il.mark(fail);
      return undefined;
    }
    patternMatch(pattern, input, fail) {
      if (pattern.hasErrors) return this.unsupported('a pattern the binder could not bind', pattern.syntax);
      const handler = this['match' + pattern.kind];
      if (!handler) return this.unsupported(`${describeKind(pattern.kind)}s`, pattern.syntax);
      return handler.call(this, pattern, input, fail);
    }
    matchDiscardPattern() {}
    matchVarPattern(pattern, input) {
      if (!pattern.local) return;
      this.il.emit('ldloc', input.slot);
      this.initializeLocal(pattern.local);
    }
    matchTypePattern(pattern, input, fail) {
      this.typeTest(pattern.testedType, input, fail, null);
    }
    matchDeclarationPattern(pattern, input, fail) {
      this.typeTest(pattern.testedType, input, fail, this.storeInto(pattern.local));
    }
    /** A function that stores the value on the stack as the first value of a pattern variable; null without one. */
    storeInto(local) {
      return local ? () => this.initializeLocal(local) : null;
    }
    /**
     * Tests the input for a type and, on success, hands the converted value to `store` (when there is one).
     * @param {(() => void)|null} store consumes the value of type `type` that is on the stack
     */
    typeTest(type, input, fail, store) {
      const il = this.il,
        token = this.tokens.type(type);
      if (!isReference(input.type) && !isTypeParameter(input.type)) {
        // A non-nullable value: the binder has shown whether the type matches.
        if (!input.type.equals(type) && !isReference(type)) return il.emit('br', fail);
        if (!store) return undefined;
        il.emit('ldloc', input.slot);
        if (isReference(type)) il.emit('box', this.tokens.type(input.type));
        return store();
      }
      this.pushReference(input);
      il.emit('isinst', token);
      if (isReference(type) && !isTypeParameter(type)) {
        if (!store) return il.emit('brfalse', fail);
        il.emit('dup');
        store();
        return il.emit('brfalse', fail);
      }
      il.emit('brfalse', fail);
      if (!store) return undefined;
      this.pushReference(input);
      il.emit('unbox.any', token);
      return store();
    }
    /**
     * `Type { Member: pattern, ... } name` and `Type(p1, p2)`: the value is narrowed to the type (or checked for
     * null), then each member - or each part a `Deconstruct` method yields - is matched against its pattern.
     */
    matchRecursivePattern(pattern, input, fail) {
      const il = this.il,
        type = pattern.testedType ?? pattern.inputType ?? input.type;
      let narrowed = input;
      if (pattern.testedType && !pattern.testedType.equals(input.type)) {
        narrowed = { slot: this.temp(type), type };
        this.typeTest(type, input, fail, () => il.emit('stloc', narrowed.slot));
      } else this.matchNotNull(input, fail);
      const pushValue = () => il.emit(isReference(narrowed.type) ? 'ldloc' : 'ldloca', narrowed.slot);
      for (const property of pattern.properties ?? []) {
        if (!property.member) return this.unsupported('this property pattern', property.syntax);
        const part = { slot: this.temp(property.member.type), type: property.member.type };
        pushValue();
        this.readMember(property.member, narrowed.type);
        il.emit('stloc', part.slot);
        this.patternMatch(property.pattern, part, fail);
      }
      if (pattern.hasPositional) this.positionalParts(pattern, pushValue, narrowed.type, fail);
      if (pattern.local) {
        il.emit('ldloc', narrowed.slot);
        this.initializeLocal(pattern.local);
      }
      return undefined;
    }
    /** A recursive pattern does not match null. */
    matchNotNull(input, fail) {
      if (!isReference(input.type) && !isTypeParameter(input.type)) return;
      this.pushReference(input);
      this.il.emit('brfalse', fail);
    }
    /** Reads a field or property of the value (or address) on the stack. */
    readMember(member, receiverType) {
      if (member.kind === SymbolKind.Field) return this.il.emit('ldfld', this.tokens.field(member));
      if (!member.getMethod) return this.unsupported(`reading '${member.toDisplayString()}' in a pattern`);
      return this.callMethod(member.getMethod, { receiver: { type: receiverType } });
    }
    /** `(p1, p2)` over a type with a `Deconstruct` method: the parts are its `out` arguments. */
    positionalParts(pattern, pushValue, type, fail) {
      const positional = pattern.positional,
        method = positional?.method;
      if (!positional || positional.kind !== 'method' || !method || positional.isExtension) {
        return this.unsupported('positional patterns over tuples and extension Deconstruct methods', pattern.syntax);
      }
      const parts = positional.parts.map(part => ({ slot: this.temp(part.type), type: part.type }));
      pushValue();
      for (const part of parts) this.il.emit('ldloca', part.slot);
      this.callMethod(method, { receiver: { type } });
      positional.parts.forEach((part, index) => this.patternMatch(part.pattern, parts[index], fail));
      return undefined;
    }
    matchConstantPattern(pattern, input, fail) {
      const il = this.il,
        value = pattern.value,
        constant = value.constantValue;
      if (!constant || constant.isNull) {
        if (!isReference(input.type) && !isTypeParameter(input.type)) return this.unsupported('a null pattern over a value type', pattern.syntax);
        this.pushReference(input);
        return il.emit('brtrue', fail);
      }
      if (constant.type === 'string') {
        this.pushReference(input);
        if (!isString(input.type)) il.emit('isinst', this.tokens.type(this.core.string));
        this.constantValue(constant, pattern.syntax);
        return this.stringEquality(fail);
      }
      this.unboxedInput(input, value.type, fail);
      this.constantValue(constant, pattern.syntax);
      return il.emit('ceq').emit('brfalse', fail);
    }
    stringEquality(fail) {
      const string = this.core.string,
        shape = { isStatic: true, returnType: this.core.bool, parameters: [{ type: string }, { type: string }] };
      this.il.emit('call', this.tokens.external(string, 'op_Equality', shape), { pops: 2, pushes: 1 });
      return this.il.emit('brfalse', fail);
    }
    /** Pushes the input as a value of `type`: directly when it is one, else after testing the box for exactly that type. */
    unboxedInput(input, type, fail) {
      const il = this.il;
      if (primitiveOf(input.type)) return il.emit('ldloc', input.slot);
      if (!isReference(input.type) && !isTypeParameter(input.type)) return this.unsupported('a constant pattern over a struct');
      const token = this.tokens.type(type);
      this.pushReference(input);
      il.emit('isinst', token).emit('brfalse', fail);
      this.pushReference(input);
      return il.emit('unbox.any', token);
    }
    matchRelationalPattern(pattern, input, fail) {
      const value = pattern.value;
      this.unboxedInput(input, value.type, fail);
      this.expression(value);
      this.binaryInstruction({ operator: pattern.operator, left: { type: value.type }, right: value, syntax: pattern.syntax });
      return this.il.emit('brfalse', fail);
    }
    matchNotPattern(pattern, input, fail) {
      const il = this.il,
        matched = il.newLabel();
      this.patternMatch(pattern.pattern, input, matched);
      il.emit('br', fail);
      il.mark(matched);
    }
    matchAndPattern(pattern, input, fail) {
      this.patternMatch(pattern.left, input, fail);
      this.patternMatch(pattern.right, input, fail);
    }
    matchOrPattern(pattern, input, fail) {
      const il = this.il,
        tryRight = il.newLabel(),
        matched = il.newLabel();
      this.patternMatch(pattern.left, input, tryRight);
      il.emit('br', matched);
      il.mark(tryRight);
      this.patternMatch(pattern.right, input, fail);
      il.mark(matched);
    }
  };
