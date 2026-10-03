/** Rectangular arrays and Span values in the semantic lowering path. */
import {Op, spanType} from '@sharpforge/bytecode';
import {n} from './node-factory.js';

function operation(type, memory, args, receiver = null) {
  return {kind: 'Call', legacyType: type, isExpression: true, receiver, method: null, args, intrinsic: {memory}};
}

function index(value, vector = false) {
  if (value.legacyType === 'int') return value;
  const type = vector && value.legacyType === 'uint' ? 'nuint' : vector ? 'nint' : 'int';
  return n.convert(value, type, true);
}

function access(receiver, args, element, rank, readonly = false) {
  return {kind: 'IndexerAccess', legacyType: element, isExpression: true, receiver, args,
    indexer: {memory: {kind: spanType(receiver.legacyType) ? 'span' : 'rect', rank, readonly, element}}};
}

function initializer(values, rank) {
  const lengths = Array(rank).fill(0), entries = [];
  function walk(items, depth, indices) {
    lengths[depth] = Math.max(lengths[depth], items.length);
    items.forEach((item, i) => {
      if (depth + 1 < rank) walk(item, depth + 1, [...indices, i]);
      else entries.push({indices: [...indices, i], value: item});
    });
  }
  if (values) walk(values, 0, []);
  return {lengths, entries};
}

export const MemoryTranslation = Base => class extends Base {
  defaultValue(type) {
    const span = spanType(type);
    return span ? operation(type, {op: Op.SPANDEFAULT, element: span.element, b: Number(span.readonly)}, []) : super.defaultValue(type);
  }

  exprArrayAccess(node) {
    const receiver = this.expression(node.array), args = node.indices.map(value => index(this.expression(value), node.indices.length === 1));
    if (node.indices.length === 1) return n.arrayElement(receiver, args[0]);
    return access(receiver, args, this.imageType(node.type, node.syntax), node.indices.length);
  }

  exprArrayCreation(node) {
    const element = this.imageType(node.type.elementType, node.syntax), rank = node.type.rank;
    if (rank === 1) {
      const elements = node.elements?.map(value => this.expression(value));
      const length = node.sizes?.length ? index(this.expression(node.sizes[0]), true) : n.literal(elements?.length ?? 0, 'int');
      return n.newArray(element, length, elements);
    }
    return this.memoryAllocation(node, element, rank, false);
  }

  memoryAllocation(node, element, rank, stack) {
    const initial = initializer(node.elements, rank);
    const sizes = Array.from({length: rank}, (_, i) => node.sizes?.[i] ? index(this.expression(node.sizes[i])) :
      n.literal(initial.lengths[i], 'int'));
    return operation(this.imageType(node.type, node.syntax), {kind: 'allocate', element, rank, stack,
      indices: initial.entries.map(entry => entry.indices)}, [...sizes, ...initial.entries.map(entry => this.expression(entry.value))]);
  }

  exprStackAlloc(node) {
    return this.memoryAllocation(node, this.imageType(node.elementType, node.syntax), 1, true);
  }

  frameworkCreation(node) {
    const type = this.imageType(node.type, node.syntax);
    return spanType(type) && !node.args?.length ? this.defaultValue(type) : super.frameworkCreation(node);
  }

  propertyReference(node) {
    const receiverType = node.receiver && this.imageType(node.receiver.type, node.syntax);
    if (spanType(receiverType) && node.property.name === 'Length') {
      return operation('int', {op: Op.SPANLENGTH}, [], this.expression(node.receiver));
    }
    return super.propertyReference(node);
  }

  frameworkInvocation(node, method) {
    const type = node.receiver && this.imageType(node.receiver.type, node.syntax);
    if (spanType(type) && method.name === 'Slice') {
      return operation(type, {op: Op.SPANSLICE, b: node.args.length}, this.arguments(node, method), this.expression(node.receiver));
    }
    return super.frameworkInvocation(node, method);
  }

  indexerReference(node) {
    const type = this.imageType(node.receiver.type, node.syntax), span = spanType(type);
    if (span) return access(this.expression(node.receiver), node.args.map(argument => index(this.expression(argument.expression))),
      span.element, 1, span.readonly);
    return super.indexerReference(node);
  }

  exprConversion(node) {
    const target = this.imageType(node.type, node.syntax), to = spanType(target);
    const source = this.imageType(node.operand.type, node.syntax), from = spanType(source);
    if (to?.readonly && from && to.element === from.element) {
      return to.readonly === from.readonly ? this.expression(node.operand) :
        operation(target, {op: Op.SPANREADONLY}, [this.expression(node.operand)]);
    }
    return super.exprConversion(node);
  }
};
