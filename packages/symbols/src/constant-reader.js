import { Reader, decodeConstant as decodePrimitive, decodeCoded } from '@sharpforge/cil';
import { fail } from './contracts.js';

const primitives = Object.freeze({
  2: ['bool', 1],
  3: ['char', 2],
  4: ['sbyte', 1],
  5: ['byte', 1],
  6: ['short', 2],
  7: ['ushort', 2],
  8: ['int', 4],
  9: ['uint', 4],
  10: ['long', 8],
  11: ['ulong', 8],
  12: ['float', 4],
  13: ['double', 8],
});

function typeHandle(reader, counts) {
  const encoded = reader.compressed();
  if (!(encoded >>> 2) || encoded >>> 2 > 0xffffff) fail('Invalid local constant type handle');
  const token = decodeCoded('TypeDefOrRef', encoded);
  const row = token & 0xffffff;
  if (!row || (counts && row > (counts[token >>> 24] ?? 0))) fail('Invalid local constant type handle');
  return { encoded, token };
}

function primitive(reader, kind, counts) {
  const [type, width] = primitives[kind];
  const bytes = reader.take(width);
  if (kind === 2 && bytes[0] > 1) fail('Invalid local constant Boolean');
  let value = decodePrimitive(kind, bytes);
  // Preserve the established PDB API: characters are UTF-16 units, and 64-bit values are always BigInt.
  if (kind === 3) value = value.charCodeAt(0);
  if (kind === 10 || kind === 11) value = BigInt(value);
  let enumType = null;
  let enumTypeToken;
  if (reader.position < reader.end) {
    if (kind > 11) fail('Unexpected local constant payload');
    const handle = typeHandle(reader, counts);
    enumType = handle.encoded;
    enumTypeToken = handle.token;
  }
  if (reader.position !== reader.end) fail('Unexpected local constant payload');
  return { type, value, decoded: true, enumType, ...(enumTypeToken ? { enumTypeToken } : {}) };
}

function general(reader, kind, bytes, counts) {
  if (kind === 28) {
    if (reader.position !== reader.end) fail('Unexpected local constant payload');
    return { type: 'object', value: null, decoded: true, enumType: null };
  }
  if (kind !== 17 && kind !== 18) fail('Invalid local constant signature type');
  const { token: typeToken } = typeHandle(reader, counts);
  if (kind === 18 && reader.position === reader.end) {
    return { type: 'class', value: null, decoded: true, enumType: null, typeToken };
  }
  return {
    type: 'signature',
    decoded: false,
    reason: 'type-metadata-required',
    typeKind: kind === 17 ? 'valuetype' : 'class',
    typeToken,
    defaultValue: reader.position === reader.end,
    raw: new Uint8Array(bytes),
  };
}

function prefix(reader, counts, limit, modifiers) {
  let kind = reader.u8();
  let count = 0;
  while (kind === 31 || kind === 32) {
    if (++count > limit) fail('Local constant modifier limit exceeded');
    const token = typeHandle(reader, counts).token;
    if (modifiers) modifiers.push({ required: kind === 31, typeToken: token });
    kind = reader.u8();
  }
  return { kind, count };
}

/** Count custom modifiers without allocating records, for aggregate preflight. */
export function constantModifierCount(bytes, counts, limit) {
  return prefix(new Reader(bytes), counts, limit).count;
}

/** Inspect a general constant's payload without copying its already-owned signature. */
export function generalConstantPayload(bytes, counts) {
  const reader = new Reader(bytes);
  const { kind } = prefix(reader, counts, 1024);
  if (kind !== 17 && kind !== 18) fail('Invalid general local constant');
  const { token } = typeHandle(reader, counts);
  return { kind, typeToken: token, bytes: reader.take(reader.end - reader.position) };
}

/** Decode one complete LocalConstantSig; type-dependent values stay explicitly unresolved without PE metadata. */
export function decodeConstant(bytes, { counts, maxBytes = 16 * 1024 * 1024, maxModifiers = 64 } = {}) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > 64 * 1024 * 1024 ||
    !(bytes instanceof Uint8Array) ||
    bytes.length > maxBytes
  )
    fail('Local constant byte limit exceeded');
  if (!Number.isInteger(maxModifiers) || maxModifiers < 0 || maxModifiers > 1024)
    fail('Invalid local constant modifier limit');
  const reader = new Reader(bytes);
  const modifiers = [];
  const { kind } = prefix(reader, counts, maxModifiers, modifiers);
  let result;
  if (Object.hasOwn(primitives, kind)) result = primitive(reader, kind, counts);
  else if (kind === 14) {
    const payload = reader.take(reader.end - reader.position);
    const value = payload.length === 1 && payload[0] === 255 ? null : decodePrimitive(14, payload, { maxBytes });
    result = { type: 'string', value, decoded: true, enumType: null };
  } else result = general(reader, kind, bytes, counts);
  return modifiers.length ? { ...result, customModifiers: modifiers } : result;
}
