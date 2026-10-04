import { CilError } from '../binary.js';

export const metadataCodedIndices = {
  ResolutionScope: [2, [0, 26, 35, 1]],
  TypeDefOrRef: [2, [2, 1, 27]],
  MemberRefParent: [3, [2, 1, 26, 6, 27]],
  HasConstant: [2, [4, 8, 23]],
  HasCustomAttribute: [5, [6, 4, 1, 2, 8, 9, 10, 0, 14, 23, 20, 17, 26, 27, 32, 35, 38, 39, 40, 42, 44, 43]],
  CustomAttributeType: [3, [null, null, 6, 10, null]],
  HasFieldMarshal: [1, [4, 8]],
  HasDeclSecurity: [2, [2, 6, 32]],
  HasSemantics: [1, [20, 23]],
  MethodDefOrRef: [1, [6, 10]],
  MemberForwarded: [1, [4, 6]],
  Implementation: [2, [38, 35, 39]],
  TypeOrMethodDef: [1, [2, 6]],
  HasCustomDebugInformation: [5, [6, 4, 1, 2, 8, 9, 10, 0, 14, 23, 20, 17, 26, 27, 32, 35, 38, 39, 40, 42, 44, 43, 48, 50, 51, 52, 53]],
};

/** Construct the stable CLI token from a table id and one-based row number. */
export function token(table, row) {
  return (table * 0x1000000 + row) >>> 0;
}

/** Encode a token using the tag layout for the named coded-index kind. */
export function codedIndex(kind, metadataToken) {
  if (!metadataToken) return 0;
  const [bits, tables] = metadataCodedIndices[kind];
  const table = metadataToken >>> 24;
  const tag = tables.indexOf(table);
  if (tag < 0) throw new CilError(`Token cannot be encoded as ${kind}`);
  return (metadataToken & 0xffffff) * 2 ** bits + tag;
}

/** Decode a physical coded index, rejecting reserved tags. */
export function decodeCoded(kind, value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new CilError('Invalid physical coded index');
  if (value === 0) return 0;
  const [bits, tables] = metadataCodedIndices[kind];
  const row = value >>> bits;
  if (row > 0xffffff) throw new CilError(`${kind} row exceeds 24-bit token range`);
  const table = tables[value & ((1 << bits) - 1)];
  if (table === undefined || table === null) throw new CilError(`Invalid ${kind} tag`);
  return token(table, row);
}

/** Compute a column width in bytes from row counts and the heap-size bit field. */
export function metadataIndexWidth(kind, counts, heaps) {
  if (kind === 'u16') return 2;
  if (kind === 'u32') return 4;
  if (kind === 'str') return heaps & 1 ? 4 : 2;
  if (kind === 'guid') return heaps & 2 ? 4 : 2;
  if (kind === 'blob') return heaps & 4 ? 4 : 2;
  if (/^t\d+$/.test(kind)) return (counts[Number(kind.slice(1))] ?? 0) < 65536 ? 2 : 4;
  const [bits, references] = metadataCodedIndices[kind];
  const boundary = 2 ** (16 - bits);
  return references.some(table => table !== null && (counts[table] ?? 0) >= boundary) ? 4 : 2;
}
