import {Builtins} from '@sharpforge/bytecode';
import {ArrayTypeSymbol} from '../../symbols/types.js';
import {n} from './node-factory.js';

const integer = value => n.literal(value, 'int');

function member(receiver, name, args = []) {
  const builtin = Builtins.find(entry => entry?.arrayRuntime?.name === name && !entry.arrayRuntime.isStatic &&
    entry.arrayRuntime.parameters.length === args.length);
  return n.frameworkCall({builtin}, receiver, args, builtin.arrayRuntime.returnType);
}

/** Main's array member/foreach lowering over E01 managed rectangular storage. */
export const RuntimeArrayTranslation = Base => class extends Base {
  exprArrayLength(node) {
    const array = node.operand ?? node.array ?? node.receiver;
    if (!(array.type instanceof ArrayTypeSymbol)) return super.exprArrayLength(node);
    return member(this.expression(array), 'get_' + (node.member ?? 'Length'));
  }

  exprCall(node) {
    const method = node.method?.originalDefinition ?? node.method;
    if (!method?.arrayMember || !(node.receiver?.type instanceof ArrayTypeSymbol)) return super.exprCall(node);
    return member(this.expression(node.receiver), method.arrayMember,
      node.args.map(argument => this.expression(argument.expression)));
  }

  stmtForEach(node) {
    const type = node.collection?.type;
    if (!node.local || !(type instanceof ArrayTypeSymbol) || type.rank === 1) return super.stmtForEach(node);
    return this.scoped(() => {
      const span = this.span(node.syntax);
      const array = this.holder(this.imageType(type, node.syntax), 'array');
      const linear = this.holder('int', 'index');
      const lengths = Array.from({length: type.rank}, () => this.holder('int', 'length'));
      const lowerBounds = Array.from({length: type.rank}, () => this.holder('int', 'lowerBound'));
      const setup = [array.init(this.expression(node.collection), span), linear.init(integer(0))];
      lengths.forEach((length, dimension) => {
        setup.push(length.init(member(array.read(), 'GetLength', [integer(dimension)])));
        setup.push(lowerBounds[dimension].init(member(array.read(), 'GetLowerBound', [integer(dimension)])));
      });
      const indices = [];
      let stride = integer(1);
      for (let dimension = type.rank - 1; dimension >= 0; dimension--) {
        const quotient = dimension === type.rank - 1 ? linear.read() : n.binary('/', linear.read(), stride, 'int');
        indices[dimension] = n.binary('+', n.binary('%', quotient, lengths[dimension].read(), 'int'),
          lowerBounds[dimension].read(), 'int');
        stride = n.binary('*', stride, lengths[dimension].read(), 'int');
      }
      const element = this.imageType(type.elementType, node.syntax);
      const access = {kind: 'IndexerAccess', legacyType: element, isExpression: true, receiver: array.read(),
        args: indices, indexer: {memory: {kind: 'rect', rank: type.rank, readonly: false, element}}};
      const iterationType = this.imageType(node.local.type, node.syntax);
      const body = this.scoped(() => [
        ...this.declareVariable(node.local, element === iterationType ? access : n.convert(access, iterationType), span),
        this.embedded(node.body)
      ]);
      return [...setup, {kind: 'ForStatement', syntax: span, locals: [], initializer: null,
        condition: n.binary('<', linear.read(), member(array.read(), 'get_Length'), 'bool'), body,
        increment: n.increment('++', linear.read(), true), labels: []}];
    });
  }
};
