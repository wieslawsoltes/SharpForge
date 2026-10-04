/** Creation and initializer visitors for expression-tree lowering (SF-A02-T07.5). */
import { TypeKind, ArrayTypeSymbol } from '../symbols/types.js';

function binding(builder, entry) {
  const member = entry.target.field ?? (entry.target.kind === 'PropertyAccess' ? entry.target.property : null);
  if (!member) builder.fail('an index initializer', entry.target);
  if (entry.value.kind === 'ObjectInitializer') builder.fail('a nested initializer', entry.value);
  return { member, expression: builder.visit(entry.value) };
}

function elementInit(builder, call) {
  if (call.isExtension) builder.fail('an extension Add method', call);
  return { addMethod: call.method, arguments: builder.arguments(call) };
}

function objectCreation(node) {
  if (node.type?.typeKind === TypeKind.Delegate) this.fail('a delegate creation', node);
  const creation = this.node('New', node.type, { constructor: node.constructor ?? null, arguments: this.arguments(node) });
  if (node.initializers?.length) {
    const bindings = node.initializers.map(entry => binding(this, entry));
    return this.node('MemberInit', node.type, { newExpression: creation, bindings });
  }
  if (node.collectionInitializers?.length) {
    const initializers = node.collectionInitializers.map(call => elementInit(this, call));
    return this.node('ListInit', node.type, { newExpression: creation, initializers });
  }
  return creation;
}

function arrayAccess(node) {
  if (node.indices.length !== 1) this.fail('a multi-dimensional array access', node);
  return this.node('ArrayIndex', node.type, { operands: [this.visit(node.array), this.visit(node.indices[0])] });
}

function arrayCreation(node) {
  if (!(node.type instanceof ArrayTypeSymbol) || node.type.rank !== 1) this.fail('a multi-dimensional array creation', node);
  const elementType = node.type.elementType;
  if (node.elements) return this.node('NewArrayInit', node.type, { elementType, expressions: node.elements.map(element => this.visit(element)) });
  return this.node('NewArrayBounds', node.type, { elementType, expressions: node.sizes.map(size => this.visit(size)) });
}

/** Bound node kind -> visitor, called with the tree builder as `this`. */
export const expressionTreeCreationVisitors = Object.freeze({
  ObjectCreation: objectCreation,
  ArrayAccess: arrayAccess,
  ArrayCreation: arrayCreation,
});
