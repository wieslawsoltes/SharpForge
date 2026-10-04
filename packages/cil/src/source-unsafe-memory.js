import {Op, Binary, BinaryName} from '@sharpforge/bytecode';
import {CilError} from './binary.js';
import {memoryTypeName} from './source-memory-types.js';

const pointer = type => typeof type === 'string' && type.endsWith('*');
const comparisons = new Map([['==', 'ceq'], ['!=', 'ceq'], ['<', 'clt.un'], ['>', 'cgt.un'], ['<=', 'cgt.un'], ['>=', 'clt.un']]);

export const sourceLocalSignatureType = local => local.type + (local.pinned ? ' pinned' : '');
export function decodedSourceLocalType(local, nativeType) {
  const pinned = nativeType.endsWith(' pinned');
  if (!!local.pinned !== pinned) throw new CilError('Pinned source local metadata disagrees with its CLI signature');
  return pinned ? nativeType.slice(0, -7) : nativeType;
}

export function transferSourceUnsafeMemory({op, a, stack, pop, image}) {
  switch (op) {
    case Op.PIN: case Op.PTRCONVERT: case Op.STACKALLOC_RAW: pop(); stack.push(image.constants[a] + '*'); break;
    case Op.UNPIN: stack.push('null'); break;
    case Op.SIZEOF: stack.push('int'); break;
    case Op.BINARY: {
      if (!stack.slice(-2).some(pointer)) return false;
      const right = pop(), left = pop(), operator = BinaryName[a];
      stack.push(comparisons.has(operator) ? 'bool' : pointer(left) && pointer(right) ? 'nint' : pointer(left) ? left : right);
      break;
    }
    default: return false;
  }
  return true;
}

export function emitSourceUnsafeMemory(w, c, {op, a, b, input}) {
  switch (op) {
    case Op.PIN: w.local('stloc', b).local('ldloc', b).op('conv.u'); break;
    case Op.UNPIN: w.integer(0).op('conv.u').local('stloc', a).op('ldnull'); break;
    case Op.SIZEOF: w.op('sizeof', c.resolveType(c.image.constants[a])); break;
    case Op.PTRCONVERT:
      if (input.at(-1) === 'null') w.op('pop').integer(0);
      w.op('conv.u').op('ldtoken', c.resolveType(c.image.constants[a])).op('pop').op('nop').op('nop'); break;
    case Op.STACKALLOC_RAW:
      w.op('conv.ovf.u').op('sizeof', c.resolveType(c.image.constants[a])).op('mul.ovf.un').op('localloc'); break;
    case Op.BINARY: {
      if (!input.slice(-2).some(pointer)) return false;
      const operator = BinaryName[a];
      if (comparisons.has(operator)) {
        w.op(comparisons.get(operator));
        if (['!=', '<=', '>='].includes(operator)) w.integer(0).op('ceq');
        w.op('nop');
      } else if (operator === '+' || operator === '-') w.op(operator === '+' ? 'add' : 'sub');
      else throw new CilError('Unsupported pointer operation');
      break;
    }
    default: return false;
  }
  return true;
}

const local = (instruction, prefix) => instruction?.name === prefix || instruction?.name === prefix + '.s' ? instruction.operand
  : instruction?.name.startsWith(prefix + '.') ? Number(instruction.name.slice(prefix.length + 1)) : null;
const emit = (op, a = 0, b = 0) => [op, a, b];
const type = (c, instruction) => memoryTypeName(c.metadata.typeName(instruction.operand));
const zero = instruction => instruction?.name === 'ldc.i4.0' ||
  (instruction?.name === 'ldc.i4' || instruction?.name === 'ldc.i4.s') && instruction.operand === 0;

export function decodeSourceUnsafeMemory(span, c) {
  const names = span.map(instruction => instruction.name);
  if (names.at(-1) === 'localloc') {
    const size = span.find(instruction => instruction.name === 'sizeof');
    if (size) return emit(Op.STACKALLOC_RAW, c.intern(type(c, size)));
  }
  if (span.length === 1 && names[0] === 'sizeof') return emit(Op.SIZEOF, c.intern(type(c, span[0])));
  if (names.at(-1) === 'nop' && names.at(-2) === 'nop' && names.at(-3) === 'pop' &&
      names.at(-4) === 'ldtoken' && names.at(-5) === 'conv.u') return emit(Op.PTRCONVERT, c.intern(type(c, span.at(-4))));
  if (span.length === 3 && names[2] === 'conv.u') {
    const slot = local(span[0], 'stloc');
    if (slot !== null && c.method.locals[slot]?.pinned && local(span[1], 'ldloc') === slot)
      return emit(Op.PIN, c.intern(c.method.locals[slot].type.slice(0, -1)), slot);
  }
  if (span.length === 4 && zero(span[0]) && names[1] === 'conv.u' && names[3] === 'ldnull') {
    const slot = local(span[2], 'stloc');
    if (slot !== null && c.method.locals[slot]?.pinned) return emit(Op.UNPIN, slot);
  }
  if (names.at(-1) === 'nop' && ['ceq', 'clt.un', 'cgt.un'].includes(names[0])) {
    const inverted = names.length === 4 && zero(span[1]) && names[2] === 'ceq';
    if (names.length !== 2 && !inverted) return null;
    const operator = names[0] === 'ceq' ? inverted ? '!=' : '==' : names[0] === 'clt.un' ? inverted ? '>=' : '<' : inverted ? '<=' : '>';
    return emit(Op.BINARY, Binary[operator]);
  }
  return null;
}
