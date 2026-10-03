import {Op} from '@sharpforge/bytecode';
import {CilError} from './binary.js';

/** Emit ordinary CIL addresses and typed loads/stores, preserving the source store's result. */
export function emitReferenceInstruction(writer, context, instruction) {
  const {op, a, b, input, scratch} = instruction;
  if (op === Op.LDIND) { writer.op('ldobj', context.resolveType(context.image.constants[a])); return true; }
  if (op === Op.STIND) {
    const type = context.image.constants[a], value = scratch(type, 2800);
    writer.local('stloc', value).local('ldloc', value).op('stobj', context.resolveType(type)).local('ldloc', value);
    return true;
  }
  if (op !== Op.ADDRESS) return false;
  const kind = a & 3;
  if (a & 8) writer.local('ldloc', b);
  else if (kind === 0) writer.op('ldloca', b);
  else if (kind === 1) writer.op('ldsflda', context.staticTokens[b]);
  else if (kind === 2) {
    const field = context.fieldTokens.get(input.at(-1).replace(/&$/, '') + ':' + b);
    if (!field) throw new CilError('Unknown addressed field');
    writer.op('ldflda', field);
  } else {
    if (a & 4) writer.op('readonly.');
    writer.op('ldelema', context.resolveType(input.at(-2).slice(0, -2)));
  }
  if (a & 12) writer.integer(a & 12).op('pop');
  return true;
}

/** Decode only our bounded superinstruction shapes; canonical re-emission verifies all operands. */
export function decodeReferenceInstruction(span, context, emit) {
  const load = span.find(item => item.name === 'ldobj');
  const store = span.find(item => item.name === 'stobj');
  if (load || store) {
    const type = context.metadata.typeName((load ?? store).operand);
    return emit(load ? Op.LDIND : Op.STIND, context.intern(context.shortType(type)));
  }
  const marker = span.at(-1)?.name === 'pop' ? span.at(-2) : null;
  if (marker?.name === 'ldc.i4.8' || marker?.name === 'ldc.i4.s' && marker.operand === 12) {
    const local = span[0];
    const slot = local.operand ?? Number(local.name.split('.').at(-1));
    return emit(Op.ADDRESS, marker.name === 'ldc.i4.8' ? 8 : 12, slot);
  }
  return false;
}
