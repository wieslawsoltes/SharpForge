import { codedIndex, decodeCoded, metadataSchemas, token } from '@sharpforge/cil';
import { SymbolError } from './contracts.js';

export function generationError(code, message) {
  throw new SymbolError(message, { code, format: 'Portable PDB' });
}

/** Copy authoritative aggregate CLI row counts; a PDB delta only declares its own generation's counts. */
export function generationRowCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    generationError('PDB_DELTA_COUNTS', 'PDB delta requires aggregate type-system row counts');
  }
  const result = {};
  for (const [key, count] of Object.entries(value)) {
    const table = Number(key);
    if (
      String(table) !== key || table < 0 || table >= 48 || table === 30 || table === 31 ||
      !metadataSchemas[table] || !Number.isInteger(count) || count < 0 || count > 0xffffff
    ) {
      generationError('PDB_DELTA_COUNTS', 'Invalid PDB delta aggregate type-system row count');
    }
    result[table] = count;
  }
  return result;
}

/** Project delta-local method references while retaining original bytes, row offsets and heap accessors. */
export function projectPdbDelta(metadata, typeSystemRowCounts) {
  const counts = generationRowCounts(typeSystemRowCounts);
  if (!metadata.minimalDelta || !Object.hasOwn(metadata.rows, 31)) {
    generationError('PDB_DELTA_FORMAT', 'PDB delta requires #-/#JTD and an EncMap table');
  }
  if (Object.keys(metadata.rows).some((table) => +table !== 31 && (+table < 48 || +table > 55))) {
    generationError('PDB_DELTA_TABLE', 'PDB delta contains unsupported non-debug tables');
  }
  const mapping = metadata.rows[31];
  if (mapping.length !== (metadata.counts[49] ?? 0) || mapping.length !== (metadata.externalCounts[6] ?? 0)) {
    generationError('PDB_DELTA_MAP', 'PDB delta EncMap must contain exactly one entry per method row');
  }
  for (const [table, count] of Object.entries(metadata.externalCounts)) {
    if (count > (counts[table] ?? 0)) {
      generationError('PDB_DELTA_COUNTS', 'PDB delta rows exceed aggregate type-system row counts');
    }
  }
  let previous = 0;
  const methodTokens = mapping.map(([handle]) => {
    const row = handle & 0xffffff;
    if (handle >>> 24 !== 49 || row <= previous || row > (counts[6] ?? 0)) {
      generationError('PDB_DELTA_MAP', 'PDB delta EncMap requires increasing, valid MethodDebugInformation tokens');
    }
    previous = row;
    return token(6, row);
  });
  const method = (row) => {
    if (!Number.isInteger(row) || row < 1 || row > methodTokens.length) {
      generationError('PDB_DELTA_METHOD', 'Invalid PDB delta local method reference');
    }
    return methodTokens[row - 1];
  };
  const rows = { ...metadata.rows };
  if (rows[50]) rows[50] = rows[50].map(([row, ...rest]) => [method(row) & 0xffffff, ...rest]);
  if (rows[54]) rows[54] = rows[54].map(([moveNext, kickoff]) => [method(moveNext) & 0xffffff, kickoff]);
  if (rows[55]) rows[55] = rows[55].map(([parent, kind, value]) => {
    const handle = decodeCoded('HasCustomDebugInformation', parent);
    const mapped = handle >>> 24 === 6 ? codedIndex('HasCustomDebugInformation', method(handle & 0xffffff)) : parent;
    return [mapped, kind, value];
  });
  return { metadata: { ...metadata, rows, externalCounts: counts }, methodTokens };
}
