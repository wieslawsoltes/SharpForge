/** Native rectangular arrays retain CLR rank, bounds, covariance, and element addresses. */
import {ArrayTypeSymbol} from '../symbols/types.js';
import {n} from '../codegen/semantic/node-factory.js';
import {rectangularArray, rectangularElement} from '../codegen/memory-nodes.js';
import {arrayCall, memoryCall} from './memory-builtins.js';

const integer = value => n.literal(value, 'int');
const isRectangular = type => type instanceof ArrayTypeSymbol && type.rank > 1;

function initializerEntries(elements, rank, lower, indices = []) {
  if (rank === 1) return elements.map((value, index) => ({indices: [...indices, index], value: lower(value)}));
  return elements.flatMap((items, index) => initializerEntries(items, rank - 1, lower, [...indices, index]));
}

export const ArrayTranslation = Base => class extends Base {
  exprArrayCreation(node) {
    if (!isRectangular(node.type)) return super.exprArrayCreation(node);
    const elementType = this.imageType(node.type.elementType, node.syntax);
    const lengths = node.sizes?.length ? node.sizes.map(size => this.expression(size)) : [];
    if (!lengths.length) {
      for (let level = node.elements, rank = 0; rank < node.type.rank; rank++, level = level?.[0])
        lengths.push(integer(level?.length ?? 0));
    }
    const initializer = node.elements ? initializerEntries(node.elements, node.type.rank,
      value => this.objectArgument(this.expression(value), elementType)) : null;
    return rectangularArray(elementType, lengths, initializer);
  }
  exprArrayAccess(node) {
    if (!isRectangular(node.array.type)) return super.exprArrayAccess(node);
    return rectangularElement(this.expression(node.array), node.indices.map(index => this.expression(index)),
      this.imageType(node.type, node.syntax));
  }
  exprArrayLength(node) {
    const array = this.expression(node.operand ?? node.array ?? node.receiver);
    if (node.member === 'Rank' || node.member === 'LongLength') return arrayCall('get_' + node.member, array);
    return n.arrayLength(array);
  }
  exprCall(node) {
    const definition = node.method.originalDefinition ?? node.method;
    if (definition.arrayMember) return arrayCall(definition.arrayMember, this.expression(node.receiver), this.arguments(node, node.method));
    const builtin = definition.builtin ?? node.method.builtin;
    if (builtin?.arrayRuntime) return n.frameworkCall({builtin}, node.method.isStatic ? null : this.expression(node.receiver),
      this.arguments(node, node.method), this.imageType(node.type, node.syntax));
    return super.exprCall(node);
  }
  exprConversion(node) {
    const from = node.operand.type, to = node.type, kind = node.conversion?.kind;
    if ((from instanceof ArrayTypeSymbol || to instanceof ArrayTypeSymbol ||
        from === this.g.analysis.core.array || to === this.g.analysis.core.array) &&
        ['Identity', 'ImplicitReference', 'ExplicitReference'].includes(kind)) {
      const value = this.expression(node.operand), type = this.imageType(to, node.syntax);
      return kind === 'ExplicitReference' ? memoryCall('cast', [value, n.literal(type, 'string')], type) : value;
    }
    return super.exprConversion(node);
  }
  /** Cache dimensions once and enumerate row-major, retaining normal break/continue targets. */
  stmtForEach(node) {
    if (!node.local || !isRectangular(node.collection?.type)) return super.stmtForEach(node);
    return this.scoped(() => {
      const type = node.collection.type, span = this.span(node.syntax);
      const array = this.holder(this.imageType(type, node.syntax), 'array'), index = this.holder('int', 'index');
      const lengths = Array.from({length: type.rank}, () => this.holder('int', 'length'));
      const start = [array.init(this.expression(node.collection), span), index.init(integer(0)),
        ...lengths.map((length, dimension) => length.init(arrayCall('GetLength', array.read(), [integer(dimension)])))];
      const indices = lengths.map((length, dimension) => {
        const stride = lengths.slice(dimension + 1).map(item => item.read()).reduce((a, b) => n.binary('*', a, b, 'int'), integer(1));
        return n.binary('%', n.binary('/', index.read(), stride, 'int'), length.read(), 'int');
      });
      const element = rectangularElement(array.read(), indices, this.imageType(type.elementType, node.syntax));
      const body = this.scoped(() => [...this.declareVariable(node.local, element, span), this.embedded(node.body)]);
      return [...start, {kind: 'ForStatement', syntax: span, locals: [], initializer: null,
        condition: n.binary('<', index.read(), n.arrayLength(array.read()), 'bool'), body,
        increment: n.assign(index.read(), n.binary('+', index.read(), integer(1), 'int')), labels: []}];
    });
  }
};
