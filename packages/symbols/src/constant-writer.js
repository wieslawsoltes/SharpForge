import { Writer, codedIndex } from '@sharpforge/cil';
import { fail } from './contracts.js';

const integerTypes = Object.freeze({
  char: [3, 0, 65535, 'u16'],
  sbyte: [4, -128, 127, 'u8'],
  byte: [5, 0, 255, 'u8'],
  short: [6, -32768, 32767, 'u16'],
  ushort: [7, 0, 65535, 'u16'],
  int: [8, -2147483648, 2147483647, 'u32'],
  uint: [9, 0, 4294967295, 'u32'],
});

function writeInteger(writer, type, value) {
  const [code, minimum, maximum, method] = integerTypes[type];
  if (typeof value === 'string' && type === 'char' && value.length === 1) value = value.charCodeAt(0);
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail('Local constant value outside ' + type);
  writer.u8(code)[method](value);
}

function writeWideInteger(writer, type, value) {
  if (typeof value !== 'bigint') fail('64-bit local constant requires BigInt');
  const signed = type === 'long';
  const minimum = signed ? -(1n << 63n) : 0n;
  const maximum = signed ? (1n << 63n) - 1n : (1n << 64n) - 1n;
  if (value < minimum || value > maximum) fail('Local constant value outside ' + type);
  writer.u8(signed ? 10 : 11).i64(BigInt.asIntN(64, value));
}

const encoders = {
  ...Object.fromEntries(
    Object.keys(integerTypes).map((type) => [type, (writer, value) => writeInteger(writer, type, value)]),
  ),
  bool(writer, value) {
    if (typeof value !== 'boolean') fail('Boolean local constant requires boolean');
    writer.u8(2).u8(value ? 1 : 0);
  },
  long: (writer, value) => writeWideInteger(writer, 'long', value),
  ulong: (writer, value) => writeWideInteger(writer, 'ulong', value),
  float(writer, value) {
    if (typeof value !== 'number') fail('Floating local constant requires number');
    writer.u8(12).f32(value);
  },
  double(writer, value) {
    if (typeof value !== 'number') fail('Floating local constant requires number');
    writer.u8(13).f64(value);
  },
  string(writer, value) {
    writer.u8(14);
    if (value === null) writer.u8(255);
    else {
      if (typeof value !== 'string') fail('String local constant requires string or null');
      for (let index = 0; index < value.length; index++) writer.u16(value.charCodeAt(index));
    }
  },
  object(writer, value) {
    if (value !== null) fail('Object local constant must be null');
    writer.u8(28);
  },
};

/** Encode a typed constant or preserve a caller-supplied CLI LocalConstantSig blob. */
export function writeConstant(constant, counts) {
  if (constant.signature !== undefined) {
    if (!(constant.signature instanceof Uint8Array) || !constant.signature.length)
      fail('Invalid local constant signature');
    return constant.signature;
  }
  const encode = Object.hasOwn(encoders, constant.type) ? encoders[constant.type] : null;
  if (!encode) fail('Unsupported local constant type: ' + constant.type);
  const writer = new Writer();
  encode(writer, constant.value);
  if (constant.enumType !== undefined) {
    const table = constant.enumType >>> 24;
    const row = constant.enumType & 0xffffff;
    const integral = integerTypes[constant.type] || ['bool', 'long', 'ulong'].includes(constant.type);
    if (!integral || ![1, 2, 27].includes(table) || row < 1 || row > (counts[table] ?? 0))
      fail('Invalid enum constant type');
    writer.compressed(codedIndex('TypeDefOrRef', constant.enumType));
  }
  return writer.finish();
}
