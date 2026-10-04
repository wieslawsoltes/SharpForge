/** Expression factory calls for creation and initializers (SF-A02-T07.5). */
import { TypeKind } from '../../symbols/types.js';

function newExpression(node) {
  const { newExpression, constructorInfo } = this.types,
    constructor = node.constructor;
  if (node.members?.length) {
    this.anonymousMethodOf(node.type, '.ctor');
    this.expressions(node.arguments);
    this.array(this.types.memberInfo, node.members.map(member => () => this.methodOf(member.getMethod)));
    return this.factory('New', [constructorInfo, this.core.ienumerableT.construct(this.expression), this.arrayOf(this.types.memberInfo)], newExpression);
  }
  // A synthesized constructor with parameters still constructs a value; only the implicit zero-argument struct case is default(T).
  if (!constructor || (constructor.isImplicitlyDeclared && !constructor.parameters.length && node.type.typeKind === TypeKind.Struct)) {
    this.typeOf(node.type);
    return this.factory('New', [this.core.type], newExpression);
  }
  this.methodOf(constructor);
  this.expressions(node.arguments);
  return this.factory('New', [constructorInfo, this.arrayOf(this.expression)], newExpression);
}

function emitBinding(writer, binding) {
  const factory = binding.factory ?? 'Bind';
  const accessor = factory === 'Bind' ? binding.member.setMethod : binding.member.getMethod;
  if (accessor) writer.methodOf(accessor);
  else writer.fieldOf(writer.tokens.field(binding.member), binding.member.containingType);
  const memberType = accessor ? writer.types.methodInfo : writer.types.memberInfo;
  if (factory === 'MemberBind') {
    writer.array(writer.types.memberBinding, binding.bindings.map(child => () => emitBinding(writer, child)));
    return writer.factory(factory, [memberType, writer.arrayOf(writer.types.memberBinding)], writer.result('MemberMemberBinding'));
  }
  if (factory === 'ListBind') {
    writer.array(writer.types.elementInit, binding.initializers.map(initializer => () => emitElementInit(writer, initializer)));
    return writer.factory(factory, [memberType, writer.arrayOf(writer.types.elementInit)], writer.result('MemberListBinding'));
  }
  writer.emit(binding.expression);
  return writer.factory('Bind', [memberType, writer.expression], writer.result('MemberAssignment'));
}

function emitElementInit(writer, initializer) {
  writer.methodOf(initializer.addMethod);
  writer.expressions(initializer.arguments);
  return writer.factory('ElementInit', [writer.types.methodInfo, writer.arrayOf(writer.expression)], writer.types.elementInit);
}

function memberInit(node) {
  const { memberBinding, newExpression } = this.types;
  this.emit(node.newExpression);
  this.array(memberBinding, node.bindings.map(binding => () => emitBinding(this, binding)));
  return this.factory('MemberInit', [newExpression, this.arrayOf(memberBinding)], this.result('MemberInitExpression'));
}

function listInit(node) {
  const { elementInit, newExpression } = this.types;
  this.emit(node.newExpression);
  this.array(elementInit, node.initializers.map(initializer => () => emitElementInit(this, initializer)));
  return this.factory('ListInit', [newExpression, this.arrayOf(elementInit)], this.result('ListInitExpression'));
}

function arrayIndex(node) {
  this.emit(node.operands[0]);
  if (node.operands.length === 2) {
    this.emit(node.operands[1]);
    return this.factory('ArrayIndex', [this.expression, this.expression], this.result('BinaryExpression'));
  }
  this.expressions(node.operands.slice(1));
  return this.factory('ArrayIndex', [this.expression, this.arrayOf(this.expression)], this.result('MethodCallExpression'));
}

function newArray(node) {
  this.typeOf(node.elementType);
  this.expressions(node.expressions);
  return this.factory(node.factory, [this.core.type, this.arrayOf(this.expression)], this.result('NewArrayExpression'));
}

/** Factory name -> emitter, called with the expression-tree factory writer as `this`. */
export const expressionTreeCreationFactories = Object.freeze({
  New: newExpression,
  MemberInit: memberInit,
  ListInit: listInit,
  ArrayIndex: arrayIndex,
  NewArrayInit: newArray,
  NewArrayBounds: newArray,
});
