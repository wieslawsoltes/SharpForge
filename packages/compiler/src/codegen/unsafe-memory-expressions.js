import {Op, Binary} from '@sharpforge/bytecode';

function pointerUpdate(e, node) {
  const reference = e.prepare(node.operand ?? node.left);
  e.loadRef(reference);
  const previous = node.isPostfix ? e.temp(reference.type) : null;
  if (previous !== null) e.emit(Op.STLOC, previous);
  e.expr(node.offset);
  e.emit(Op.BINARY, Binary[node.operator === '--' ? '-' : node.operator === '++' ? '+' : node.operator]);
  e.storeRef(reference);
  if (previous !== null) { e.emit(Op.POP); e.emit(Op.LDLOC, previous); }
}

export function emitUnsafeMemoryExpression(e, node) {
  switch (node.kind) {
    case 'MemorySize': e.emit(Op.SIZEOF, e.c.constant(node.elementType)); break;
    case 'MemoryPin': e.expr(node.address); e.emit(Op.PIN, e.c.constant(node.elementType), e.slot(node.local)); break;
    case 'MemoryUnpin': e.emit(Op.UNPIN, e.slot(node.local)); break;
    case 'PointerConversion': e.expr(node.operand); e.emit(Op.PTRCONVERT, e.c.constant(node.elementType)); break;
    case 'PointerBinary': e.expr(node.left); e.expr(node.right); e.emit(Op.BINARY, Binary[node.operator]); break;
    case 'PointerIncrement': case 'PointerCompound': pointerUpdate(e, node); break;
    case 'RawStackAllocation': {
      e.expr(node.length); e.emit(Op.STACKALLOC_RAW, e.c.constant(node.elementType));
      (node.initializer ?? []).forEach((value, index) => {
        e.emit(Op.DUP); e.emitConstant(index); e.emit(Op.SIZEOF, e.c.constant(node.elementType));
        e.emit(Op.BINARY, Binary['*'], 1); e.emit(Op.BINARY, Binary['+']);
        e.expr(value); e.emit(Op.STIND, e.c.constant(node.elementType)); e.emit(Op.POP);
      });
      break;
    }
    default: return false;
  }
  return true;
}
