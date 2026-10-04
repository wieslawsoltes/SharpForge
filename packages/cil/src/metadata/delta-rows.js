import { token } from './indices.js';
import { tableDefinitions } from './tables.js';
import { generationError } from './delta-contracts.js';
import { latestGenerationRevision } from './delta-map.js';

export function generationRowRecord(entry, localToken, aggregateToken, operation) {
  const table = localToken >>> 24, localRow = localToken & 0xffffff;
  const values = entry.metadata.rows[table]?.[localRow - 1];
  if (!values) generationError('MD_GEN_TOKEN', 'Physical metadata row is unavailable');
  operation.charge(values.length * 8);
  const metadataOffset = entry.metadata.tableOffset + entry.metadata.rowOffsets[table][localRow - 1];
  return { token: aggregateToken, table, name: tableDefinitions[table].name,
    generation: entry.generation, localToken, sourceOffset: entry.metadataOffset + metadataOffset,
    metadataOffset, byteLength: entry.rowWidths[table], values: values.slice() };
}

/** A current raw record keeps the generation that supplied it, independent of its original definition. */
export function selectedGenerationRow(state, revisions, value, generation, operation) {
  const table = value >>> 24, row = value & 0xffffff;
  if (row > (state.entries[generation].counts[table] ?? 0)) {
    generationError('MD_GEN_TOKEN', 'Entity handle belongs to a future generation');
  }
  const revision = latestGenerationRevision(revisions.get(value), generation);
  const sourceGeneration = revision?.generation ?? 0;
  const localRow = revision?.localRow ?? row;
  return generationRowRecord(state.entries[sourceGeneration], token(table, localRow), value, operation);
}

/** Commit performs only owned array/map updates after all admission and cancellation checks succeed. */
export function commitMetadataGeneration(state, revisions, entry) {
  if (entry.generation > 0) {
    for (const mapping of Object.values(entry.localToAggregate)) {
      for (let index = 0; index < mapping.length; index++) {
        const value = mapping[index];
        const history = revisions.get(value) ?? [];
        history.push({ generation: entry.generation, localRow: index + 1 });
        revisions.set(value, history);
      }
    }
  }
  state.entries.push(entry);
  state.byteCount += entry.bytes.length;
  state.recordCount += entry.recordCount;
}
