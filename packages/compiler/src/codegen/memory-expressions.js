import {Op} from '@sharpforge/bytecode';
import {managedAddress} from './memory-nodes.js';

const isMemoryLocation = node => ['ManagedDereference', 'RectangularElement', 'SpanElement'].includes(node.kind) ||
  node.kind === 'FieldAccess' && !node.field.legacy.isStatic &&
    (node.field.legacy.owner.valueType || node.receiver.kind === 'ManagedDereference');
const addressable = node => node.kind === 'Sequence' ? addressable(node.value) :
  ['Local', 'Parameter', 'ThisReference', 'FieldAccess', 'ArrayAccess', 'ManagedDereference',
    'RectangularElement', 'SpanElement'].includes(node.kind);

/** Instance value calls receive the original storage address, or an addressable rvalue temporary. */
export function emitManagedReceiver(e, receiver, owner) {
  if (!owner?.valueType || receiver.legacyType.endsWith('&')) { e.expr(receiver); return; }
  if (addressable(receiver)) e.expr(managedAddress(receiver));
  else {
    const slot = e.temp(receiver.legacyType);
    e.expr(receiver); e.emit(Op.STLOC, slot); e.emit(Op.POP); e.emit(Op.ADDRESS, 1, slot);
  }
}

export function emitMemoryDefault(e, type) {
  if (!/^System\.(?:ReadOnly)?Span(?:`1)?</.test(type)) return false;
  e.emit(Op.SPANDEFAULT, e.c.constant(type));
  return true;
}

function address(e, node, readonly = false) {
  const flag = readonly ? 0x100 : 0;
  switch (node.kind) {
    case 'Local': e.emit(Op.ADDRESS, 1 | flag, e.slot(node.local)); break;
    case 'Parameter': e.emit(Op.ADDRESS, 1 | flag, e.slot(node.parameter)); break;
    case 'ThisReference':
      if (node.legacyType.endsWith('&')) e.expr(node);
      else e.emit(Op.ADDRESS, 1 | flag, e.thisSlot ?? 0);
      break;
    case 'ManagedDereference':
      e.expr(node.address);
      if (readonly) e.emit(Op.ADDRESS, 5 | flag);
      break;
    case 'FieldAccess': {
      const field = node.field.legacy;
      if (field.isStatic) e.emit(Op.ADDRESS, 2 | flag, field.index);
      else {
        if (node.receiver.kind === 'ManagedDereference' || field.owner.valueType) e.expr(managedAddress(node.receiver));
        else e.expr(node.receiver);
        e.emit(Op.ADDRESS, 4 | flag, field.index);
      }
      break;
    }
    case 'ArrayAccess':
      e.expr(node.expression); e.expr(node.index);
      e.emit(Op.ADDRESS, 3 | flag, e.c.constant(node.legacyType));
      break;
    case 'RectangularElement':
      e.expr(node.array); e.args(node.indices); e.emit(Op.RECTADDR, node.indices.length);
      if (readonly) e.emit(Op.ADDRESS, 5 | flag);
      break;
    case 'SpanElement':
      e.expr(node.span); e.expr(node.index); e.emit(Op.SPANADDR);
      if (readonly || node.readonly) e.emit(Op.ADDRESS, 5 | 0x100);
      break;
    default: throw new Error(`Cannot take the managed address of '${node.kind}'`);
  }
}

function newArray(e, node) {
  if (node.length) e.expr(node.length);
  else e.emitConstant(node.hasInitializer ? node.initializer.length : 0);
  e.emit(Op.NEWARR, e.c.constant(node.legacyType.slice(0, -2)));
  if (node.hasInitializer) node.initializer.forEach((value, index) => {
    e.emit(Op.DUP); e.emitConstant(index); e.expr(value); e.emit(Op.STELEM); e.emit(Op.POP);
  });
}

function newRectangularArray(e, node) {
  e.args(node.lengths);
  e.emit(Op.NEWRECT, e.c.constant(node.elementType), node.lengths.length);
  for (const {indices, value} of node.initializer ?? []) {
    e.emit(Op.DUP);
    for (const index of indices) e.emitConstant(index);
    e.expr(value); e.emit(Op.STRECT, indices.length); e.emit(Op.POP);
  }
}

function stackAllocation(e, node) {
  e.expr(node.length); e.emit(Op.STACKALLOC, e.c.constant(node.elementType));
  (node.initializer ?? []).forEach((value, index) => {
    e.emit(Op.DUP); e.emitConstant(index); e.expr(value); e.emit(Op.SPANSET); e.emit(Op.POP);
  });
}

/** Storage operations share the ordinary dispatcher, sequence points, and instruction budget. */
export function emitMemoryExpression(e, node) {
  switch (node.kind) {
    case 'ManagedAddress': address(e, node.target, node.readonly); break;
    case 'ManagedDereference': e.expr(node.address); e.emit(Op.LDIND, e.c.constant(node.legacyType)); break;
    case 'ArrayCreation': newArray(e, node); break;
    case 'RectangularArray': newRectangularArray(e, node); break;
    case 'RectangularElement': e.expr(node.array); e.args(node.indices); e.emit(Op.LDRECT, node.indices.length); break;
    case 'StackAllocation': stackAllocation(e, node); break;
    case 'SpanDefault': e.emit(Op.SPANDEFAULT, e.c.constant(node.legacyType)); break;
    case 'SpanElement': e.expr(node.span); e.expr(node.index); e.emit(Op.SPANGET); break;
    case 'SpanLength': e.expr(node.span); e.emit(Op.SPANLENGTH); break;
    case 'SpanReadOnly': e.expr(node.span); e.emit(Op.SPANREADONLY); break;
    case 'SpanSlice': e.expr(node.span); e.args(node.args); e.emit(Op.SPANSLICE, 0, node.args.length); break;
    default: return false;
  }
  return true;
}

export function prepareMemoryReference(e, node) {
  if (!isMemoryLocation(node)) return null;
  const slot = e.temp(node.legacyType + '&');
  e.expr(managedAddress(node)); e.emit(Op.STLOC, slot); e.emit(Op.POP);
  return {kind: 'managed', type: node.legacyType, slot};
}

export function loadMemoryReference(e, ref) {
  if (ref.kind !== 'managed') return false;
  e.emit(Op.LDLOC, ref.slot); e.emit(Op.LDIND, e.c.constant(ref.type));
  return true;
}

export function storeMemoryReference(e, ref) {
  if (ref.kind !== 'managed') return false;
  const value = e.temp(ref.type);
  e.emit(Op.STLOC, value); e.emit(Op.POP); e.emit(Op.LDLOC, ref.slot); e.emit(Op.LDLOC, value);
  e.emit(Op.STIND, e.c.constant(ref.type)); e.clear(value); e.clear(ref.slot);
  return true;
}
