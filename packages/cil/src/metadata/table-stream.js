import { Writer, Reader, CilError } from '../binary.js';
import { tableDefinitions } from './tables.js';
import { metadataIndexWidth } from './indices.js';
import { metadataColumnKind } from './pointer-tables.js';

function columnWidths(table, counts, flags, uncompressed, minimalDelta = false) {
  return tableDefinitions[table].types.map((_, column) => {
    const kind = metadataColumnKind(table, column, counts, uncompressed);
    return metadataIndexWidth(kind, counts, flags, minimalDelta);
  });
}

/** Serialize table rows without truncating values that exceed their physical column width. */
export function writeMetadataTables(rows, options) {
  const { heapFlags, sortedMask, uncompressed, extraData } = options;
  const counts = Object.fromEntries(Object.entries(rows).map(([table, records]) => [table, records.length]));
  let validMask = 0n;
  for (const table of Object.keys(rows)) {
    if (!tableDefinitions[table]) throw new CilError(`Unsupported metadata table ${table}`);
    if (counts[table] > 0xffffff) throw new CilError('Metadata table exceeds token row range');
    validMask |= 1n << BigInt(table);
  }
  const writer = new Writer().u32(0).u8(2).u8(0).u8(heapFlags).u8(1);
  for (const mask of [validMask, sortedMask]) writer.u32(Number(mask & 0xffffffffn)).u32(Number(mask >> 32n));
  for (let table = 0; table < 64; table++) if (Object.hasOwn(counts, table)) writer.u32(counts[table]);
  if (extraData !== undefined) {
    if (!Number.isInteger(extraData) || extraData < 0 || extraData > 0xffffffff) throw new CilError('Invalid metadata ExtraData');
    writer.u32(extraData);
  }
  for (let table = 0; table < 64; table++) {
    if (!counts[table]) continue;
    const widths = columnWidths(table, counts, heapFlags, uncompressed);
    for (const row of rows[table]) {
      if (!Array.isArray(row) || row.length !== widths.length) throw new CilError('Invalid metadata table row');
      row.forEach((value, column) => {
        const width = widths[column];
        if (!Number.isInteger(value) || value < 0 || value > (width === 2 ? 0xffff : 0xffffffff)) {
          throw new CilError(`Metadata table ${table} column ${column} exceeds its ${width}-byte range`);
        }
        if (width === 2) writer.u16(value);
        else writer.u32(value);
      });
    }
  }
  return writer.finish();
}

function externalPdbCounts(stream) {
  const counts = {};
  if (!stream) return counts;
  const reader = new Reader(stream);
  reader.take(24);
  const low = reader.u32(), high = reader.u32();
  for (let table = 0; table < 64; table++) {
    if (!((table < 32 ? low >>> table : high >>> (table - 32)) & 1)) continue;
    counts[table] = reader.u32();
    if (counts[table] > 0xffffff) throw new CilError('Invalid external PDB row count');
  }
  if (reader.position !== reader.end) throw new CilError('Trailing #Pdb bytes');
  return counts;
}

/** Precheck the entire table payload before creating any row arrays. */
export function readMetadataTables(streams, bytes, budget) {
  budget?.check();
  const uncompressed = !streams.has('#~') && streams.has('#-');
  const minimalDelta = streams.has('#JTD');
  if (minimalDelta && (!uncompressed || streams.get('#JTD').length !== 0)) {
    throw new CilError('Invalid minimal metadata delta marker');
  }
  const tableBytes = streams.get('#~') ?? streams.get('#-');
  if (!tableBytes) throw new CilError('Missing metadata tables');
  const reader = new Reader(tableBytes);
  reader.u32();
  const major = reader.u8();
  reader.u8();
  const heapFlags = reader.u8();
  reader.u8();
  if (major !== 2) throw new CilError('Unsupported metadata table version');
  const low = reader.u32(), high = reader.u32();
  const sortedLow = reader.u32(), sortedHigh = reader.u32();
  const counts = {}, rows = {}, rowOffsets = {}, widths = {};
  let total = 0;
  for (let table = 0; table < 64; table++) {
    if (!((table < 32 ? low >>> table : high >>> (table - 32)) & 1)) continue;
    if (!tableDefinitions[table]) throw new CilError(`Unsupported metadata table ${table}`);
    counts[table] = reader.u32();
    total += counts[table];
    if (total > (budget?.maxRows ?? 1_000_000)) {
      const error = new CilError('Metadata row limit exceeded');
      if (budget) error.code = 'MD_READ_ROW_LIMIT';
      throw error;
    }
  }
  const extraData = heapFlags & 0x40 ? reader.u32() : undefined;
  const externalCounts = externalPdbCounts(streams.get('#Pdb'));
  const indexCounts = { ...externalCounts, ...counts };
  let requiredBytes = 0;
  for (const table of Object.keys(counts)) {
    widths[table] = columnWidths(table, indexCounts, heapFlags, uncompressed, minimalDelta);
    requiredBytes += counts[table] * widths[table].reduce((sum, width) => sum + width, 0);
  }
  if (requiredBytes > reader.end - reader.position) throw new CilError('Truncated metadata table payload', reader.position);
  for (const table of Object.keys(counts)) {
    rows[table] = [];
    rowOffsets[table] = [];
    for (let index = 0; index < counts[table]; index++) {
      if (budget && (index & 255) === 0) budget.check();
      rowOffsets[table].push(reader.position);
      rows[table].push(widths[table].map(width => width === 2 ? reader.u16() : reader.u32()));
    }
  }
  return { rows, counts, rowOffsets, externalCounts, heapFlags, uncompressed, minimalDelta, extraData,
    sortedMask: BigInt(sortedLow) | (BigInt(sortedHigh) << 32n), tableOffset: tableBytes.byteOffset - bytes.byteOffset };
}
