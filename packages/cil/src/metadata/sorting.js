import { tableDefinitions } from './tables.js';
import { metadataCodedIndices } from './indices.js';

// ECMA-335 II.22 required keys. Dependencies precede tables containing their handles.
const sortOrder = [9, 11, 13, 14, 15, 16, 24, 25, 28, 29, 41, 42, 44, 12, 50, 54, 55];
export const metadataSortKeys = Object.freeze({
  9: [0, 1], 11: [1], 12: [0], 13: [0], 14: [1], 15: [2], 16: [1], 24: [2],
  25: [0], 28: [1], 29: [1], 41: [0], 42: [2, 0], 44: [0], 50: [0, 4, -6], 54: [0], 55: [0],
});
export const metadataSortedMask = 0x16003301fa00n;

function remapReferences(rows, target, rowMap) {
  for (const [table, records] of Object.entries(rows)) {
    const definition = tableDefinitions[table];
    for (let column = 0; column < definition.types.length; column++) {
      const kind = definition.types[column];
      if (kind === `t${target}`) {
        for (const row of records) if (rowMap[row[column]]) row[column] = rowMap[row[column]];
        continue;
      }
      const coded = metadataCodedIndices[kind];
      if (!coded || !coded[1].includes(target)) continue;
      const [bits, targets] = coded;
      const tag = targets.indexOf(target);
      const mask = (1 << bits) - 1;
      for (const row of records) {
        const value = row[column];
        if ((value & mask) === tag && rowMap[value >>> bits]) row[column] = rowMap[value >>> bits] * 2 ** bits + tag;
      }
    }
  }
}

/** Sort a copy and retarget every metadata reference; original builder handles stay stable. */
export function sortMetadataRows(source) {
  const rows = Object.fromEntries(Object.entries(source).map(([table, records]) => [table, records.map(row => [...row])]));
  const tokenMap = new Map();
  let sortedMask = metadataSortedMask;
  for (const table of sortOrder) {
    const records = rows[table];
    if (!records?.length) continue;
    if (table >= 48) sortedMask |= 1n << BigInt(table);
    const keys = metadataSortKeys[table];
    const sorted = records.map((row, index) => ({ row, index })).sort((left, right) => {
      for (const key of keys) {
        const column = key < 0 ? -key - 1 : key;
        const difference = left.row[column] - right.row[column];
        if (difference) return key < 0 ? -difference : difference;
      }
      return left.index - right.index;
    });
    const rowMap = new Uint32Array(records.length + 1);
    sorted.forEach(({ index }, newIndex) => {
      rowMap[index + 1] = newIndex + 1;
      tokenMap.set(table * 0x1000000 + index + 1, table * 0x1000000 + newIndex + 1);
    });
    rows[table] = sorted.map(entry => entry.row);
    remapReferences(rows, table, rowMap);
  }
  return { rows, tokenMap, sortedMask };
}
