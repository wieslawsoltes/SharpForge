import { token } from './indices.js';
import { tableDefinitions } from './tables.js';
import { generationError, generationToken } from './delta-contracts.js';

function mapToken(value, previous) {
  if (!Number.isInteger(value) || value <= previous || !(value & 0xffffff) || value > 0x2cffffff) {
    generationError('MD_GEN_MAP', 'EncMap must contain strictly increasing nonnil CLI tokens');
  }
  const table = value >>> 24;
  if (!tableDefinitions[table] || table === 30 || table === 31) {
    generationError('MD_GEN_MAP', 'EncMap cannot map an unknown or control table');
  }
  return table;
}

/** Decode the existing physical EncMap; Module row one may be omitted by native delta writers. */
export function generationMap(metadata, previous, operation) {
  const rows = metadata.rows[31];
  if (!rows?.length) generationError('MD_GEN_MAP', 'Minimal CLI delta requires a nonempty EncMap');
  const counts = { ...previous.counts }, updates = {}, localToAggregate = {};
  const mapped = {};
  let precedingToken = -1;
  for (let index = 0; index < rows.length; index++) {
    if ((index & 255) === 0) operation.check();
    const value = rows[index][0], table = mapToken(value, precedingToken), row = value & 0xffffff;
    precedingToken = value;
    const oldCount = previous.counts[table] ?? 0;
    if (row > oldCount) {
      if (row !== (counts[table] ?? 0) + 1) generationError('MD_GEN_MAP', 'EncMap inserts must be contiguous');
      counts[table] = row;
    } else {
      updates[table] = (updates[table] ?? 0) + 1;
    }
    const local = mapped[table] ?? 0;
    if (!localToAggregate[table]) localToAggregate[table] = new Uint32Array(metadata.counts[table] ?? 0);
    if (local >= localToAggregate[table].length) generationError('MD_GEN_MAP', 'EncMap has no corresponding physical row');
    localToAggregate[table][local] = value;
    mapped[table] = local + 1;
  }
  for (const [table, count] of Object.entries(metadata.counts)) {
    if (table === '30' || table === '31') continue;
    if (table === '0') {
      if (count !== 1 || (mapped[0] && localToAggregate[0][0] !== 1)) {
        generationError('MD_GEN_MAP', 'Module mapping must identify the single existing Module row');
      }
      localToAggregate[0] = new Uint32Array([1]);
      continue;
    }
    if ((mapped[table] ?? 0) !== count) generationError('MD_GEN_MAP', 'Every physical delta row needs one EncMap token');
  }
  return { counts, updates, localToAggregate };
}

/** SRM introduction mapping; updates never move a token's defining generation. */
export function mapGenerationEntity(entries, value, atGeneration) {
  generationToken(value, true);
  const table = value >>> 24, row = value & 0xffffff;
  if (row > (entries[atGeneration].counts[table] ?? 0)) {
    generationError('MD_GEN_TOKEN', 'Entity handle belongs to a future generation');
  }
  let low = 0, high = atGeneration;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((entries[middle].counts[table] ?? 0) >= row) high = middle;
    else low = middle + 1;
  }
  const localRow = low === 0 ? row : row - (entries[low - 1].counts[table] ?? 0) + (entries[low].updates[table] ?? 0);
  return { kind: 'entity', value, generation: low, localValue: token(table, localRow) };
}

export function aggregateGenerationToken(entry, value) {
  generationToken(value);
  const table = value >>> 24, row = value & 0xffffff;
  if (row > (entry.metadata.counts[table] ?? 0)) generationError('MD_GEN_TOKEN', 'Local token is outside its physical table');
  return entry.generation === 0 ? value : entry.localToAggregate[table][row - 1];
}

export function latestGenerationRevision(revisions, generation) {
  if (!revisions?.length || revisions[0].generation > generation) return null;
  let low = 0, high = revisions.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (revisions[middle].generation <= generation) low = middle;
    else high = middle - 1;
  }
  return revisions[low];
}
