import { codedIndex } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { writeCustomDebugInformation } from './custom-debug.js';

function methodRow(value, counts) {
  const row = value & 0xffffff;
  if (!Number.isInteger(value) || value >>> 24 !== 6 || row < 1 || row > (counts[6] ?? 0))
    fail('Invalid state machine method');
  return row;
}

/** Emit each state-machine pair once, in metadata-required MoveNext order. */
export function writeStateMachines(builder, records, counts) {
  const moveNextMethods = new Set();
  const kickoffMethods = new Set();
  const rows = records.map((record) => [methodRow(record.moveNext, counts), methodRow(record.kickoff, counts)]);
  rows.sort((left, right) => left[0] - right[0]);
  for (const row of rows) {
    if (moveNextMethods.has(row[0]) || kickoffMethods.has(row[1])) fail('Duplicate state machine method');
    moveNextMethods.add(row[0]);
    kickoffMethods.add(row[1]);
    builder.add(54, row);
  }
}

/** Append CDI through registered codecs while validating its metadata parent references. */
export function appendCustomRecords(builder, records, counts, rows) {
  for (const record of records) {
    const table = record.parent >>> 24;
    const row = record.parent & 0xffffff;
    const count = table >= 48 ? (builder.rows[table]?.length ?? 0) : (counts[table] ?? 0);
    if (!Number.isInteger(record.parent) || !row || row > count) fail('Invalid custom debug parent');
    const parent = codedIndex('HasCustomDebugInformation', record.parent);
    const bytes = writeCustomDebugInformation(record.kind, record);
    rows.push([parent, builder.guid(record.kind), builder.blob(bytes)]);
  }
  rows.sort((left, right) => left[0] - right[0]);
  const seen = new Set();
  for (const row of rows) {
    const key = row[0] + ':' + row[1];
    if (seen.has(key)) fail('Duplicate custom debug information kind for parent');
    seen.add(key);
    builder.add(55, row);
  }
}
