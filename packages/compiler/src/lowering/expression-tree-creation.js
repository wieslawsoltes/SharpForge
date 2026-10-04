/** Creation and initializer visitors for expression-tree lowering (SF-A02-T07.5). */
import { TypeKind, ArrayTypeSymbol } from '../symbols/types.js';

function binding(builder, entry) {
  const member = entry.target.field ?? (entry.target.kind === 'PropertyAccess' ? entry.target.property : null);
  if (!member) builder.fail('an index initializer', entry.target);
  if (entry.value.kind === 'ObjectInitializer') {
    const value = entry.value;
    if (value.collectionInitializers?.length || value.syntax?.kind === 'CollectionInitializerExpression') {
      return { factory: 'ListBind', member, initializers: value.collectionInitializers.map(call => elementInit(builder, call)) };
    }
    return { factory: 'MemberBind', member, bindings: value.initializers.map(entry => binding(builder, entry)) };
  }
  return { factory: 'Bind', member, expression: builder.visit(entry.value) };
}

function elementInit(builder, call) {
  if (call.isExtension) builder.fail('an extension Add method', call);
  return { addMethod: call.method, arguments: builder.arguments(call) };
}

function objectCreation(node) {
  if (node.type?.typeKind === TypeKind.Delegate) this.fail('a delegate creation', node);
  const creation = this.node('New', node.type, { constructor: node.constructor ?? null, arguments: this.arguments(node) });
  if (Array.isArray(node.initializers)) {
    const bindings = node.initializers.map(entry => binding(this, entry));
    return this.node('MemberInit', node.type, { newExpression: creation, bindings });
  }
  if (Array.isArray(node.collectionInitializers)) {
    const initializers = node.collectionInitializers.map(call => elementInit(this, call));
    return this.node('ListInit', node.type, { newExpression: creation, initializers });
  }
  return creation;
}

function anonymousCreation(node) {
  return this.node('New', node.type, {
    constructor: null,
    arguments: node.initializers.map(entry => this.visit(entry.value)),
    members: node.initializers.map(entry => entry.property),
  });
}

function indexExpression(builder, index) {
  const value = builder.visit(index);
  if (index.type?.equals(builder.core.int)) return value;
  return builder.node('ConvertChecked', builder.core.int, { operands: [value] });
}

function arrayAccess(node) {
  const operands = [this.visit(node.array), ...node.indices.map(index => indexExpression(this, index))];
  return this.node('ArrayIndex', node.type, { operands }, node.indices.length === 1 ? 'ArrayIndex' : 'Call');
}

function arrayCreation(node) {
  if (!(node.type instanceof ArrayTypeSymbol)) this.fail('this array creation', node);
  const elementType = node.type.elementType;
  if (node.elements) {
    if (node.type.rank !== 1) this.fail('a multi-dimensional array initializer', node);
    return this.node('NewArrayInit', node.type, { elementType, expressions: node.elements.map(element => this.visit(element)) });
  }
  return this.node('NewArrayBounds', node.type, { elementType, expressions: node.sizes.map(size => this.visit(size)) });
}

/** Bound node kind -> visitor, called with the tree builder as `this`. */
export const expressionTreeCreationVisitors = Object.freeze({
  ObjectCreation: objectCreation,
  AnonymousObjectCreation: anonymousCreation,
  ArrayAccess: arrayAccess,
  ArrayCreation: arrayCreation,
});
