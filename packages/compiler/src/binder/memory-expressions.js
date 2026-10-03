import {Op, arrayType, spanType, memoryTypeName} from '@sharpforge/bytecode';
import {integral} from '../numeric.js';
import {BoundCall, BoundIndexerAccess, BoundConversion, BoundLiteral} from '../bound/nodes.js';

function operation(binder, syntax, type, memory, args, receiver = null) {
  return binder.node(BoundCall, syntax, {receiver, method: null, args, intrinsic: {memory}}, type);
}

function index(binder, syntax) {
  const value = binder.bindExpression(syntax), type = value.legacyType;
  if (!integral(type)) binder.c.report(syntax, 'CS0266', [type, 'int']);
  if (type === 'int') return value;
  return binder.node(BoundConversion, syntax, {
    operand: value, conversion: {kind: 'ImplicitNumeric', from: type, to: 'int'}, isExplicit: false, isChecked: true,
  }, 'int');
}

function literal(binder, value) { return binder.node(BoundLiteral, null, {value}, 'int', {constantValue: {value}}); }

function entries(binder, syntax, values, rank) {
  const lengths = Array(rank).fill(null), elements = [];
  function walk(items, depth, indices) {
    if (!Array.isArray(items)) { binder.c.report(syntax, 'CS0623'); return; }
    if (lengths[depth] === null) lengths[depth] = items.length;
    if (lengths[depth] !== items.length) binder.c.report(syntax, 'CS0847', [lengths[depth]]);
    for (let i = 0; i < items.length; i++) {
      if (depth + 1 < rank) walk(items[i], depth + 1, [...indices, i]);
      else if (Array.isArray(items[i])) binder.c.report(syntax, 'CS0623');
      else elements.push({indices: [...indices, i], syntax: items[i]});
    }
  }
  walk(values, 0, []);
  return {lengths: lengths.map(value => value ?? 0), elements};
}

function allocate(binder, syntax, stack) {
  const rank = stack ? 1 : syntax.rank;
  const initial = syntax.values ? entries(binder, syntax, syntax.values, rank) : null;
  let element = stack ? syntax.element : arrayType(syntax.type).element;
  if (element === 'var') element = initial?.elements.length ? binder.infer(initial.elements[0].syntax) : 'error';
  element = binder.c.resolveType(element, syntax, false, binder.m);
  if (stack) {
    binder.c.requireFeature(syntax, 7.2, 'Span stackalloc expressions');
    if(binder.type(element)?.isReferenceType)binder.c.report(syntax,'CS0208',[element]);
  }
  const dimensions = stack ? [syntax.length] : syntax.lengths;
  const args = [];
  for (let i = 0; i < rank; i++) {
    const size = dimensions?.[i];
    args.push(size ? index(binder, size) : literal(binder, initial?.lengths[i] ?? 0));
    if (size && initial && binder.constant(size)?.value !== initial.lengths[i]) binder.c.report(size, 'CS0847', [initial.lengths[i]]);
    if (!size && !initial && !stack) binder.c.report(syntax, 'CS1586');
  }
  for (const item of initial?.elements ?? []) {
    const value = binder.bindTyped(item.syntax, element);
    binder.checkAssign(element, value.legacyType, item.syntax);
    args.push(value);
  }
  const type = stack ? memoryTypeName('Span<' + element + '>') : element + '[' + ','.repeat(rank - 1) + ']';
  return operation(binder, syntax, type, {kind: 'allocate', stack, rank, element,
    indices: initial?.elements.map(item => item.indices) ?? []}, args);
}

export function bindMemoryIndex(binder, syntax, writing = false) {
  if (syntax.kind !== 'Index') return undefined;
  const type = binder.infer(syntax.target), span = spanType(type), array = arrayType(type);
  if (!span && !(array?.rank > 1)) return undefined;
  const rank = span ? 1 : array.rank, element = span?.element ?? array.element;
  const args = (syntax.indices ?? [syntax.index]).map(argument => index(binder, argument));
  if (args.length !== rank) binder.c.report(syntax, 'CS0022', [rank]);
  if (writing && span?.readonly) binder.c.report(syntax, 'CS8331', ['readonly Span element']);
  const indexer = {memory: {kind: span ? 'span' : 'rect', rank, readonly: !!span?.readonly, element}};
  return binder.node(BoundIndexerAccess, syntax, {receiver: binder.bindExpression(syntax.target), indexer, args}, element);
}

export function bindMemoryTyped(binder, syntax, target) {
  const to = spanType(target), from = spanType(binder.infer(syntax));
  if (!to?.readonly || !from || from.readonly || from.element !== to.element) return undefined;
  return operation(binder, syntax, memoryTypeName(target), {op: Op.SPANREADONLY}, [binder.bindExpression(syntax)]);
}

export function bindMemoryExpression(binder, syntax) {
  if (syntax.kind === 'StackAlloc') return allocate(binder, syntax, true);
  if (syntax.kind === 'NewRectangularArray') return allocate(binder, syntax, false);
  if (syntax.kind === 'Index') return bindMemoryIndex(binder, syntax);
  if (syntax.kind === 'Default' || syntax.kind === 'New' && syntax.args.length === 0) {
    const span = spanType(syntax.type);
    if (span) return operation(binder, syntax, memoryTypeName(syntax.type), {
      op: Op.SPANDEFAULT, element: span.element, b: span.readonly ? 1 : 0,
    }, []);
  }
  if (syntax.kind === 'Member' && syntax.name === 'Length' && spanType(binder.infer(syntax.target))) {
    return operation(binder, syntax, 'int', {op: Op.SPANLENGTH}, [], binder.bindExpression(syntax.target));
  }
  if (syntax.kind !== 'Call' || syntax.target.kind !== 'Member' || syntax.target.name !== 'Slice') return undefined;
  const type = binder.infer(syntax.target.target);
  if (!spanType(type)) return undefined;
  if (syntax.args.length < 1 || syntax.args.length > 2) binder.c.report(syntax, 'CS1501', ['Slice', syntax.args.length]);
  return operation(binder, syntax, type, {op: Op.SPANSLICE, b: syntax.args.length},
    syntax.args.map(argument => index(binder, argument)), binder.bindExpression(syntax.target.target));
}
