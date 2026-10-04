/** Real struct construction and cached union access for the pinned C# 15 proposal. */
import { isReference, needsBox } from './type-facts.js';
import { unionPatternOutputType } from '../../binder/unions/pattern-binding.js';
import { RefKind, TypeKind } from '../../symbols/types.js';
import { isUnionConversion } from '../../conversions/unions.js';

/** CIL registration; all storage uses the ordinary struct, property and nullable emission machinery. */
export const UnionEmission = Base => class extends Base {
  exprConversion(node) {
    if (!isUnionConversion(node.conversion)) return super.exprConversion(node);
    this.expression(node.operation);
    if (node.type.isNullableValueType) this.wrapNullable(node.type);
  }
  constructorPrologue(method) {
    const property = method.unionConstructor;
    if (!property) return super.constructorPrologue(method);
    const parameter = method.parameters[0];
    this.il.emit('ldarg', 0).emit('ldarg', 1);
    if (needsBox(parameter.type)) this.il.emit('box', this.tokens.type(parameter.type));
    this.il.emit('stfld', this.tokens.field(property.backingField));
  }
  chainedConstructorCall(call) {
    if (!call.method.originalDefinition?.unionConstructor) return super.chainedConstructorCall(call);
    this.il.emit('ldarg', 0);
    this.arguments(call, call.method);
    this.il.emit('call', this.tokens.method(call.method), { pops: call.method.parameters.length + 1, pushes: 0 });
  }
  /** Emits the address/reference of a present union; branches to absent before a getter can run. */
  unionReceiver(input, absent) {
    if (input.type.isNullableValueType) {
      this.nullableCall(input.slot, input.type, 'get_HasValue');
      this.il.emit('brfalse', absent);
      const type = input.type.nullableUnderlyingType;
      const slot = this.readOnce(input.slot, type, type, () => this.nullableCall(input.slot, input.type, 'GetValueOrDefault'));
      this.il.emit('ldloca', slot);
      return type;
    }
    if (isReference(input.type)) this.il.emit('ldloc', input.slot).emit('brfalse', absent);
    this.il.emit(isReference(input.type) ? 'ldloc' : 'ldloca', input.slot);
    return input.type;
  }
  /** Basic Value and HasValue reads are null-propagating and shared across all tests of the same input. */
  unionPropertyInput(access, input) {
    const member = access.member;
    const slot = this.readOnce(input.slot, member, member.type, () => {
      const absent = this.il.newLabel();
      const done = this.il.newLabel();
      const receiverType = this.unionReceiver(input, absent);
      this.unionMemberCall(member.getMethod, receiverType);
      if (member.refKind !== RefKind.None) this.loadIndirect(member.type);
      this.il.emit('br', done).mark(absent);
      this.defaultValue(member.type);
      this.il.mark(done);
    });
    return { slot, type: member.type };
  }
  /** A provider interface on a struct dispatches through constrained callvirt, preserving value storage. */
  unionMemberCall(method, receiverType) {
    if (method.containingType.typeKind === TypeKind.Interface && !isReference(receiverType)) {
      this.il.emit('constrained.', this.tokens.type(receiverType));
      return this.il.emit('callvirt', this.tokens.method(method), { pops: method.parameters.length + 1, pushes: 1 });
    }
    return this.callMethod(method, { receiver: { type: receiverType } });
  }
  /** The TryGetValue result and out value are evaluated once, including across failed earlier switch arms. */
  unionTryGetInput(access, input, fail) {
    const method = access.member;
    const create = flag => ({ flag, value: this.temp(access.outputType), success: this.temp(this.core.bool) });
    const entry = this.sharedEntry(input.slot, method, create) ?? create(null);
    const done = this.il.newLabel();
    if (entry.flag !== null) this.il.emit('ldloc', entry.flag).emit('brtrue', done);
    const absent = this.il.newLabel();
    const store = this.il.newLabel();
    const receiverType = this.unionReceiver(input, absent);
    this.il.emit('ldloca', entry.value);
    this.unionMemberCall(method, receiverType);
    this.il.emit('br', store).mark(absent).emit('ldc.i4', 0).mark(store).emit('stloc', entry.success);
    if (entry.flag !== null) this.il.emit('ldc.i4', 1).emit('stloc', entry.flag);
    this.il.mark(done).emit('ldloc', entry.success).emit('brfalse', fail);
    return { slot: entry.value, type: access.outputType };
  }
  unionAccessInput(access, input, fail) {
    return access.kind === 'tryGet' ? this.unionTryGetInput(access, input, fail) : this.unionPropertyInput(access, input);
  }
  patternMatch(pattern, input, fail) {
    const access = pattern.unionAccess;
    if (!access) return super.patternMatch(pattern, input, fail);
    const value = this.unionAccessInput(access, input, fail);
    if (access.kind === 'hasValue') return this.il.emit('ldloc', value.slot).emit('brtrue', fail);
    return super.patternMatch({ ...pattern, unionAccess: null }, value, fail);
  }
  /** The value source after a successful pattern, including nested and-patterns that unwrap several unions. */
  unionPatternOutput(pattern, input, fail) {
    if (pattern.kind === 'AndPattern')
      return this.unionPatternOutput(pattern.right, this.unionPatternOutput(pattern.left, input, fail), fail);
    let value = input;
    if (pattern.unionAccess && !pattern.unionAccess.isNull) value = this.unionAccessInput(pattern.unionAccess, input, fail);
    const type = unionPatternOutputType(pattern, input.type);
    return type && !type.equals(value.type) ? this.narrowedInput(value, type, fail) : value;
  }
  matchAndPattern(pattern, input, fail) {
    if (!pattern.unionValueSource) return super.matchAndPattern(pattern, input, fail);
    this.patternMatch(pattern.left, input, fail);
    const output = this.unionPatternOutput(pattern.left, input, fail);
    this.patternMatch(pattern.right, output, fail);
  }
};
