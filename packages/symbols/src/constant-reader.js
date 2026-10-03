import { Reader } from '@sharpforge/cil';
export function decodeConstant(bytes) {
  const r = new Reader(bytes),
    kind = r.u8();
  let value, type;
  const simple = {
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
  };
  if (simple[kind]) {
    [type] = simple[kind];
    if (kind === 13) value = r.f64();
    else if (kind === 12) value = r.f32();
    else if (kind === 10 || kind === 11) {
      value = r.i64();
      if (kind === 11) value = BigInt.asUintN(64, value);
    } else {
      const n = simple[kind][1];
      value = n === 1 ? r.u8() : n === 2 ? r.u16() : r.u32();
      if ([4, 6, 8].includes(kind)) value = n === 1 ? (value << 24) >> 24 : n === 2 ? (value << 16) >> 16 : value | 0;
      if (kind === 2) value = !!value;
    }
  } else if (kind === 14) {
    type = 'string';
    const b = r.take(r.end - r.position);
    value = b.length === 1 && b[0] === 255 ? null : new TextDecoder('utf-16le', { fatal: true }).decode(b);
  } else if (kind === 28) {
    type = 'object';
    value = null;
  } else return { raw: bytes.slice(), type: 'signature', decoded: false };
  return { type, value, decoded: true, enumType: r.position < r.end ? r.compressed() : null };
}
