import { CilError } from '../binary.js';

const ranges = new Map([
  [4, [-128, 127, 'u8']], [5, [0, 255, 'u8']], [6, [-32768, 32767, 'u16']], [7, [0, 65535, 'u16']],
  [8, [-2147483648, 2147483647, 'u32']], [9, [0, 4294967295, 'u32']],
]);

const wide = value => Number.isSafeInteger(Number(value)) ? Number(value) : value;
const readers = Object.freeze({
  2: reader => reader.u8() !== 0,
  3: reader => String.fromCharCode(reader.u16()),
  4: reader => reader.u8() << 24 >> 24,
  5: reader => reader.u8(),
  6: reader => reader.u16() << 16 >> 16,
  7: reader => reader.u16(),
  8: reader => reader.i32(),
  9: reader => reader.u32(),
  10: reader => wide(reader.i64()),
  11: reader => wide(BigInt.asUintN(64, reader.i64())),
  12: reader => reader.f32(),
  13: reader => reader.f64(),
});
const invalidValue = message => new CilError(message);

/** Fixed-size CLI primitive values shared by Constant and custom-attribute blobs. */
export function writePrimitiveValue(writer, code, value, invalid = invalidValue) {
  if (code === 2) {
    if (typeof value !== 'boolean') throw invalid('Expected a Boolean');
    return writer.u8(value ? 1 : 0);
  }
  if (code === 3) {
    if (typeof value !== 'string' || value.length !== 1) throw invalid('Expected one UTF-16 character');
    return writer.u16(value.charCodeAt(0));
  }
  if (code === 10 || code === 11) {
    if (typeof value !== 'bigint' && !Number.isSafeInteger(value)) throw invalid('Expected an exact 64-bit integer');
    const integer = BigInt(value);
    const signed = code === 10;
    if (integer < (signed ? -(1n << 63n) : 0n) || integer > (1n << (signed ? 63n : 64n)) - 1n) {
      throw invalid('Integer is outside its declared type range');
    }
    return writer.i64(BigInt.asIntN(64, integer));
  }
  if (code === 12 || code === 13) {
    if (typeof value !== 'number') throw invalid('Expected a floating-point number');
    return code === 12 ? writer.f32(value) : writer.f64(value);
  }
  const range = ranges.get(code);
  if (!range || !Number.isInteger(value) || value < range[0] || value > range[1]) throw invalid('Invalid primitive value');
  return writer[range[2]](value);
}

export function readPrimitiveValue(reader, code) {
  const read = readers[code];
  if (!read) throw new CilError('Invalid primitive element type');
  return read(reader);
}
