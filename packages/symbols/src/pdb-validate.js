import { decodeCoded, metadataSchemas } from '@sharpforge/cil';
import { fail } from './contracts.js';

function checkedRow(value, count, nullable, label, sentinel = false) {
  const maximum = Math.min(count, 0xffffff) + (sentinel ? 1 : 0);
  if (!Number.isInteger(value) || value < (nullable ? 0 : 1) || value > maximum) {
    fail(`Invalid Portable PDB ${label} reference`);
  }
}

function tableColumn(metadata, table, rows, column, target) {
  const sentinel = table === 50 && (column === 2 || column === 3);
  const nullable = table === 49 || table === 53 || (table === 50 && column === 1);
  const count = target >= 48 ? (metadata.counts[target] ?? 0) : (metadata.externalCounts[target] ?? 0);
  const label = `table ${table} column ${column}`;
  for (const row of rows) checkedRow(row[column], count, nullable, label, sentinel);
}

function heapColumn(metadata, table, rows, column, kind) {
  const strings = metadata.streams.get('#Strings');
  const guidCount = (metadata.streams.get('#GUID')?.length ?? 0) / 16;
  const guidLabel = `table ${table} GUID`;
  for (const row of rows) {
    const value = row[column];
    if (kind === 'blob') {
      // blob() validates the compressed extent and returns only a borrowed view; no payload is decoded or copied here.
      metadata.blob(value);
    } else if (kind === 'guid') {
      checkedRow(value, guidCount, table !== 55, guidLabel);
    } else if (value && (!strings || value >= strings.length)) {
      fail(`Invalid Portable PDB table ${table} string reference`);
    }
  }
}

/** Validate debug-table references before projecting names, scopes or opaque custom payloads. */
export function validatePdbReferences(metadata, entryPoint) {
  if (entryPoint) {
    if (entryPoint >>> 24 !== 6) fail('Invalid Portable PDB entry point token');
    checkedRow(entryPoint & 0xffffff, metadata.externalCounts[6] ?? 0, false, 'entry point');
  }
  for (const [key, rows] of Object.entries(metadata.rows)) {
    const table = Number(key),
      schema = metadataSchemas[table];
    for (let column = 0; column < schema.length; column++) {
      const kind = schema[column];
      if (kind[0] === 't') tableColumn(metadata, table, rows, column, Number(kind.slice(1)));
      else if (kind === 'blob' || kind === 'guid' || kind === 'str') heapColumn(metadata, table, rows, column, kind);
      else if (kind === 'HasCustomDebugInformation') {
        for (const row of rows) {
          const parent = decodeCoded(kind, row[column]),
            target = parent >>> 24;
          const count = target >= 48 ? (metadata.counts[target] ?? 0) : (metadata.externalCounts[target] ?? 0);
          checkedRow(parent & 0xffffff, count, false, 'custom debug parent');
        }
      }
    }
  }
}

/** The sequence-point prefix references an external StandAloneSig row even for standalone inspection. */
export function validateLocalSignatureRows(methods, counts) {
  for (const method of methods) {
    checkedRow(method.localSignature, counts[17] ?? 0, true, 'local signature');
  }
}
