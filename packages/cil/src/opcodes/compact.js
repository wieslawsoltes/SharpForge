import { CilError } from '../binary.js';

const localForms = Object.freeze({
  ldarg: Object.freeze(['ldarg.0', 'ldarg.1', 'ldarg.2', 'ldarg.3']),
  ldloc: Object.freeze(['ldloc.0', 'ldloc.1', 'ldloc.2', 'ldloc.3']),
  stloc: Object.freeze(['stloc.0', 'stloc.1', 'stloc.2', 'stloc.3']),
});
const shortLocals = Object.freeze({
  ldarg: 'ldarg.s', ldarga: 'ldarga.s', starg: 'starg.s',
  ldloc: 'ldloc.s', ldloca: 'ldloca.s', stloc: 'stloc.s',
});
const integers = Object.freeze([
  'ldc.i4.m1', 'ldc.i4.0', 'ldc.i4.1', 'ldc.i4.2', 'ldc.i4.3',
  'ldc.i4.4', 'ldc.i4.5', 'ldc.i4.6', 'ldc.i4.7', 'ldc.i4.8',
]);

export function emitLocal(writer, name, index, compact) {
  if (!Number.isInteger(index) || index < 0 || index > 65535) throw new CilError('Local index exceeds CLI limit');
  if (compact && Object.hasOwn(shortLocals, name)) {
    if (index < 4 && Object.hasOwn(localForms, name)) return writer.op(localForms[name][index]);
    if (index <= 255) return writer.op(shortLocals[name], index);
  }
  return writer.op(name, index);
}

export function emitInteger(writer, value, compact) {
  if (!compact) return writer.op('ldc.i4', value);
  if (!Number.isInteger(value) || value < -2147483648 || value > 4294967295) {
    throw new CilError('Compact integer requires a 32-bit integer bit pattern');
  }
  // ldc.i4 pushes signed int32; unsigned input literals retain the same 32 bits.
  const signed = value | 0;
  if (signed >= -1 && signed <= 8) return writer.op(integers[signed + 1]);
  return writer.op(signed >= -128 && signed <= 127 ? 'ldc.i4.s' : 'ldc.i4', signed);
}
