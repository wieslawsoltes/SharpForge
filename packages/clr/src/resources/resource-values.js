import { LoadErrorCode } from '../load-errors.js';
import { invalidResource, resourceInteger, resourceLimit } from './resource-codec.js';

/** Stable .resources v2 on-disk type codes; values 64 and above index the file's user type table. */
export const ResourceTypeCode = Object.freeze({
  Null: 0, String: 1, Boolean: 2, Char: 3, Byte: 4, SByte: 5, Int16: 6, UInt16: 7, Int32: 8, UInt32: 9,
  Int64: 10, UInt64: 11, Single: 12, Double: 13, Decimal: 14, DateTime: 15, TimeSpan: 16,
  ByteArray: 32, Stream: 33, StartOfUserTypes: 64,
});

const names = Object.freeze(Object.fromEntries(Object.entries(ResourceTypeCode).map(([name, code]) => [code, `ResourceTypeCode.${name}`])));
const opaqueDiagnostic = Object.freeze({ code: LoadErrorCode.UnsupportedFeature, severity: 'warning',
  message: 'Serialized resource data is preserved as opaque bytes; object deserialization is unsupported.' });

function decimal(reader) {
  const low = reader.u32();
  const middle = reader.u32();
  const high = reader.u32();
  const flags = reader.u32();
  const scale = (flags >>> 16) & 0xff;
  if ((flags & 0x7f00ffff) || scale > 28) throw invalidResource('Invalid resource Decimal flags');
  return Object.freeze({ coefficient: BigInt(low) | (BigInt(middle) << 32n) | (BigInt(high) << 64n),
    scale, negative: Boolean(flags & 0x80000000) });
}

function dateTime(reader) {
  const binary = reader.i64();
  const unsigned = BigInt.asUintN(64, binary);
  const kindBits = Number(unsigned >> 62n);
  if (kindBits < 2 && (unsigned & 0x3fffffffffffffffn) > 3155378975999999999n) {
    throw invalidResource('Invalid resource DateTime ticks');
  }
  // Local encodings contain timezone-dependent wrapped UTC ticks. Keep their exact binary form without consulting host timezones.
  return Object.freeze({ binary, kindBits });
}

const values = Object.freeze({
  [ResourceTypeCode.Null]: () => null,
  [ResourceTypeCode.Boolean]: reader => reader.u8() !== 0,
  [ResourceTypeCode.Char]: reader => String.fromCharCode(reader.u16()),
  [ResourceTypeCode.Byte]: reader => reader.u8(),
  [ResourceTypeCode.SByte]: reader => (reader.u8() << 24) >> 24,
  [ResourceTypeCode.Int16]: reader => (reader.u16() << 16) >> 16,
  [ResourceTypeCode.UInt16]: reader => reader.u16(),
  [ResourceTypeCode.Int32]: reader => reader.i32(),
  [ResourceTypeCode.UInt32]: reader => reader.u32(),
  [ResourceTypeCode.Int64]: reader => reader.i64(),
  [ResourceTypeCode.UInt64]: reader => BigInt.asUintN(64, reader.i64()),
  [ResourceTypeCode.Single]: reader => reader.f32(),
  [ResourceTypeCode.Double]: reader => reader.f64(),
  [ResourceTypeCode.Decimal]: decimal,
  [ResourceTypeCode.DateTime]: dateTime,
  [ResourceTypeCode.TimeSpan]: reader => Object.freeze({ ticks: reader.i64() }),
});

/** Decode one already bounded payload; byte views remain private to the owning reader until copied for a caller. */
export function readResourceValue(reader, types, codec, limits) {
  const typeCode = resourceInteger(reader);
  const rawStart = reader.position;
  const rawLength = reader.end - rawStart;
  if (rawLength > limits.maxValueBytes) throw resourceLimit('Resource value byte limit exceeded');
  let typeName = names[typeCode];
  let value;
  let diagnostic = null;
  if (typeCode >= ResourceTypeCode.StartOfUserTypes) {
    typeName = types[typeCode - ResourceTypeCode.StartOfUserTypes];
    if (typeName === undefined) throw invalidResource('Resource user type index is out of range');
    value = reader.take(rawLength);
    diagnostic = opaqueDiagnostic;
  } else if (typeCode === ResourceTypeCode.String) value = codec.string(reader, false, limits.maxStringBytes);
  else if (typeCode === ResourceTypeCode.ByteArray || typeCode === ResourceTypeCode.Stream) {
    const length = reader.i32();
    if (length < 0) throw invalidResource('Negative resource byte payload length');
    if (length > limits.maxValueBytes) throw resourceLimit('Resource byte payload limit exceeded');
    value = reader.take(length);
  } else {
    const decode = values[typeCode];
    if (!decode) throw invalidResource(`Reserved resource type code ${typeCode}`);
    value = decode(reader);
  }
  return Object.freeze({ typeCode, typeName, value, diagnostic, rawStart, rawLength });
}
