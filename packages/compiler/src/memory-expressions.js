import {Op, NumericType, numericMode, arrayType, spanType, memoryTypeName} from '@sharpforge/bytecode';
import {integral} from './numeric.js';

function shape(compiler, node) {
  const type = compiler.infer(node.target);
  const span = spanType(type), array = arrayType(type);
  if (span) return {kind: 'span', type, element: span.element, rank: 1, readonly: span.readonly};
  if (array?.rank > 1) return {kind: 'rect', type, ...array};
  return null;
}

export function inferMemoryExpression(compiler, node) {
  if (!node) return undefined;
  if (node.kind === 'StackAlloc') {
    const element = node.element === 'var' ? (node.values?.length ? compiler.infer(node.values[0]) : 'error') : node.element;
    return memoryTypeName('Span<' + element + '>');
  }
  if (node.kind === 'NewRectangularArray') {
    if (!node.type.startsWith('var[')) return memoryTypeName(node.type);
    const first = node.values?.flat(Infinity)[0];
    return (first ? compiler.infer(first) : 'error') + node.type.slice(3);
  }
  if (node.kind === 'Index') return shape(compiler, node)?.element;
  if (node.kind === 'Member' && node.name === 'Length' && spanType(compiler.infer(node.target))) return 'int';
  if (node.kind === 'Call' && node.target.kind === 'Member' && node.target.name === 'Slice') {
    const type = compiler.infer(node.target.target);
    if (spanType(type)) return type;
  }
  return undefined;
}

function integerIndex(compiler, node) {
  const type = compiler.expr(node);
  if (!integral(type)) compiler.c.report(node, 'CS0266', 'An integral array index is required');
  if (type !== 'int') compiler.emit(Op.CONVERT, NumericType.int, numericMode(type, true));
}

function indexArguments(compiler, node, rank) {
  const indices = node.indices ?? [node.index];
  if (indices.length !== rank) compiler.c.report(node, 'CS0022', `Wrong number of indices; expected ${rank}`);
  for (const index of indices) integerIndex(compiler, index);
}

function initializerShape(compiler, node, values, rank) {
  const lengths = Array(rank).fill(null), entries = [];
  function visit(items, depth, indices) {
    if (!Array.isArray(items)) {
      compiler.c.report(node, 'CS0623', 'Array initializer nesting must match its rank');
      return;
    }
    if (lengths[depth] === null) lengths[depth] = items.length;
    else if (lengths[depth] !== items.length) compiler.c.report(node, 'CS0847', 'An array initializer has an incorrect length');
    for (let i = 0; i < items.length; i++) {
      if (depth + 1 < rank) visit(items[i], depth + 1, [...indices, i]);
      else if (Array.isArray(items[i])) compiler.c.report(node, 'CS0623', 'Array initializer nesting exceeds its rank');
      else entries.push({indices: [...indices, i], value: items[i]});
    }
  }
  visit(values, 0, []);
  return {lengths: lengths.map(value => value ?? 0), entries};
}

function rectangularAllocation(compiler, node) {
  const type = compiler.c.resolveType(inferMemoryExpression(compiler, node), node);
  const {element, rank} = arrayType(type);
  const initialized = node.values ? initializerShape(compiler, node, node.values, rank) : null;
  for (let dimension = 0; dimension < rank; dimension++) {
    const length = node.lengths?.[dimension];
    if (length) {
      integerIndex(compiler, length);
      if (initialized && compiler.constant(length)?.value !== initialized.lengths[dimension]) {
        compiler.c.report(length, 'CS0150', 'An initialized array dimension must be a matching constant');
      }
    } else if (initialized) compiler.emitConstant(initialized.lengths[dimension]);
    else {
      compiler.c.report(node, 'CS1586', 'Array creation requires a size or initializer');
      compiler.emitConstant(0);
    }
  }
  compiler.emit(Op.NEWRECT, compiler.c.constant(element), rank);
  for (const {indices, value} of initialized?.entries ?? []) {
    compiler.emit(Op.DUP);
    for (const index of indices) compiler.emitConstant(index);
    compiler.checkAssign(element, compiler.typedExpr(value, element), value);
    compiler.emit(Op.STRECT, rank);
    compiler.emit(Op.POP);
  }
  return type;
}

function stackAllocation(compiler, node) {
  compiler.c.requireFeature(node, 7.2, 'Span stackalloc expressions');
  const element = compiler.c.resolveType(node.element === 'var' ? (node.values?.length ? compiler.infer(node.values[0]) : 'error') : node.element, node);
  if (node.length) integerIndex(compiler, node.length);
  else compiler.emitConstant(node.values?.length ?? 0);
  if (node.values && node.length && compiler.constant(node.length)?.value !== node.values.length) {
    compiler.c.report(node, 'CS0847', 'The stackalloc initializer length must match its constant size');
  }
  compiler.emit(Op.STACKALLOC, compiler.c.constant(element));
  for (let i = 0; i < (node.values?.length ?? 0); i++) {
    compiler.emit(Op.DUP);
    compiler.emitConstant(i);
    const value = node.values[i];
    compiler.checkAssign(element, compiler.typedExpr(value, element), value);
    compiler.emit(Op.SPANSET);
    compiler.emit(Op.POP);
  }
  return memoryTypeName('Span<' + element + '>');
}

export function compileMemoryExpression(compiler, node) {
  if(node.kind==='Default'||node.kind==='New'&&node.args.length===0){
    const span=spanType(node.type);
    if(span){compiler.emit(Op.SPANDEFAULT,compiler.c.constant(span.element),span.readonly?1:0);return memoryTypeName(node.type);}
  }
  if (node.kind === 'NewRectangularArray') return rectangularAllocation(compiler, node);
  if (node.kind === 'StackAlloc') return stackAllocation(compiler, node);
  if (node.kind === 'Index') {
    const target = shape(compiler, node);
    if (!target) return undefined;
    compiler.expr(node.target);
    indexArguments(compiler, node, target.rank);
    compiler.emit(target.kind === 'span' ? Op.SPANGET : Op.LDRECT, target.kind === 'span' ? 0 : target.rank);
    return target.element;
  }
  if (node.kind === 'Member' && node.name === 'Length' && spanType(compiler.infer(node.target))) {
    compiler.expr(node.target);
    compiler.emit(Op.SPANLENGTH);
    return 'int';
  }
  if (node.kind !== 'Call' || node.target.kind !== 'Member' || node.target.name !== 'Slice') return undefined;
  const type = compiler.infer(node.target.target);
  if (!spanType(type)) return undefined;
  if (node.args.length < 1 || node.args.length > 2) compiler.c.report(node, 'CS1501', 'Slice requires one or two arguments');
  compiler.expr(node.target.target);
  for (const argument of node.args) integerIndex(compiler, argument);
  compiler.emit(Op.SPANSLICE, 0, node.args.length);
  return type;
}

export function prepareMemoryReference(compiler, node) {
  if (node.kind !== 'Index') return null;
  const target = shape(compiler, node);
  if (!target) return null;
  if (target.readonly) compiler.c.report(node, 'CS8331', 'A readonly Span element cannot be assigned');
  compiler.expr(node.target);
  const receiver = compiler.temp(target.type);
  compiler.emit(Op.STLOC, receiver);
  compiler.emit(Op.POP);
  const indices = [];
  for (const index of node.indices ?? [node.index]) {
    integerIndex(compiler, index);
    const slot = compiler.temp('int');
    compiler.emit(Op.STLOC, slot);
    compiler.emit(Op.POP);
    indices.push(slot);
  }
  if (indices.length !== target.rank) compiler.c.report(node, 'CS0022', `Expected ${target.rank} indices`);
  return {kind: target.kind, type: target.element, receiver, indices, rank: target.rank};
}

function reloadAddress(compiler, reference) {
  compiler.emit(Op.LDLOC, reference.receiver);
  for (const index of reference.indices) compiler.emit(Op.LDLOC, index);
}

export function loadMemoryReference(compiler, reference) {
  if (!['rect', 'span'].includes(reference.kind)) return false;
  reloadAddress(compiler, reference);
  compiler.emit(reference.kind === 'rect' ? Op.LDRECT : Op.SPANGET, reference.kind === 'rect' ? reference.rank : 0);
  return true;
}

export function storeMemoryReference(compiler, reference) {
  if (!['rect', 'span'].includes(reference.kind)) return false;
  const value = compiler.temp(reference.type);
  compiler.emit(Op.STLOC, value);
  compiler.emit(Op.POP);
  reloadAddress(compiler, reference);
  compiler.emit(Op.LDLOC, value);
  compiler.emit(reference.kind === 'rect' ? Op.STRECT : Op.SPANSET, reference.kind === 'rect' ? reference.rank : 0);
  return true;
}

export function compileMemoryConversion(compiler, node, target) {
  const to = spanType(target);
  if (!to?.readonly) return undefined;
  const from = spanType(compiler.infer(node));
  if (!from || from.readonly || from.element !== to.element) return undefined;
  compiler.expr(node);
  compiler.emit(Op.SPANREADONLY);
  return memoryTypeName(target);
}
