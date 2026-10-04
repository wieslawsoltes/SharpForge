/** Expression factory calls for creation and initializers (SF-A02-T07.5). */
import { TypeKind } from '../../symbols/types.js';

function newExpression(node) {
  const { newExpression, constructorInfo } = this.types,
    constructor = node.constructor;
  if (!constructor || (constructor.isImplicitlyDeclared && node.type.typeKind === TypeKind.Struct)) {
    this.typeOf(node.type);
    return this.factory('New', [this.core.type], newExpression);
  }
  this.methodOf(constructor);
  this.expressions(node.arguments);
  return this.factory('New', [constructorInfo, this.arrayOf(this.expression)], newExpression);
}

function memberInit(node) {
  const { memberBinding, memberInfo, methodInfo, newExpression } = this.types,
    assignment = this.result('MemberAssignment'),
    bind = binding => () => {
      const setter = binding.member.setMethod ?? null;
      if (setter) this.methodOf(setter);
      else this.fieldOf(this.tokens.field(binding.member), binding.member.containingType);
      this.emit(binding.expression);
      this.factory('Bind', [setter ? methodInfo : memberInfo, this.expression], assignment);
    };
  this.emit(node.newExpression);
  this.array(memberBinding, node.bindings.map(bind));
  return this.factory('MemberInit', [newExpression, this.arrayOf(memberBinding)], this.result('MemberInitExpression'));
}

function listInit(node) {
  const { elementInit, methodInfo, newExpression } = this.types,
    element = initializer => () => {
      this.methodOf(initializer.addMethod);
      this.expressions(initializer.arguments);
      this.factory('ElementInit', [methodInfo, this.arrayOf(this.expression)], elementInit);
    };
  this.emit(node.newExpression);
  this.array(elementInit, node.initializers.map(element));
  return this.factory('ListInit', [newExpression, this.arrayOf(elementInit)], this.result('ListInitExpression'));
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
  NewArrayInit: newArray,
  NewArrayBounds: newArray,
});
