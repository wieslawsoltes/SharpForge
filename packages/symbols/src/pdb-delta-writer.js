import { CilError, token, codedIndex } from '@sharpforge/cil';
import { PdbGuids } from './contracts.js';
import { hex } from './hash.js';
import { PortablePdbBuilder } from './pdb-builder.js';
import { finishPortablePdb } from './pdb-serialization.js';
import { writeDocument } from './document-writer.js';
import { writeEmbeddedSource } from './cdi-core.js';
import { writeSequencePoints } from './sequence-points.js';
import { writeImportScopes } from './import-writer.js';
import { writeMethodScopes } from './scope-writer.js';
import { writeStateMachines, appendCustomRecords } from './custom-debug-writer.js';
import { readPortablePdbDelta } from './pdb-delta-reader.js';
import { generationError, generationRowCounts } from './pdb-delta-format.js';
import { pdbGenerationId } from './generation-identity.js';
import { preparePdbDeltaInput } from './pdb-delta-input.js';

function serialize(debug, generation, options) {
  const baselineId = pdbGenerationId(generation?.baselineId, 'baseline id');
  const previousPdbId = pdbGenerationId(generation?.previousPdbId, 'previous id');
  if (!Number.isInteger(generation.generation) || generation.generation < 1 || generation.generation > 1023) {
    generationError('PDB_GENERATION_MISMATCH', 'Invalid PDB delta generation ordinal');
  }
  const counts = generationRowCounts(generation.typeSystemRowCounts);
  const deltaCounts = generationRowCounts(generation.deltaRowCounts);
  const input = preparePdbDeltaInput(debug, counts, options);
  if (deltaCounts[6] !== input.methods.length) generationError('PDB_DELTA_COUNTS', 'PDB delta MethodDef count must match changed methods');
  for (const [table, count] of Object.entries(deltaCounts)) {
    if (count > (counts[table] ?? 0)) generationError('PDB_DELTA_COUNTS', 'PDB delta rows exceed aggregate metadata');
  }
  if (options.embedSources) input.budget.charge('records', input.sources.length, input.budget.limits.maxRecords);
  const builder = new PortablePdbBuilder();
  const customRows = [];
  for (const source of input.sources) {
    input.budget.check();
    const { id, bytes } = writeDocument(builder, source);
    if (options.embedSources) customRows.push([
      codedIndex('HasCustomDebugInformation', token(48, id)), builder.guid(PdbGuids.embeddedSource),
      builder.blob(writeEmbeddedSource({ source: bytes })),
    ]);
  }
  writeImportScopes(builder, input.imports, counts);
  const mapping = new Map(input.methods.map((method, index) => [method.token, token(6, index + 1)]));
  const mappedMethod = (methodToken) => {
    const result = mapping.get(methodToken);
    if (!result) generationError('PDB_DELTA_METHOD', 'PDB delta record refers to an unchanged method');
    return result;
  };
  for (const method of input.methods) {
    input.budget.check();
    const points = method.points;
    const singleDocument = points.length && points.every((point) => point.document === points[0].document) ? points[0].document : 0;
    const document = method.document ?? singleDocument;
    if (!Number.isInteger(document) || document < 0 || document > input.sources.length ||
        (document && points.some((point) => point.document !== document))) {
      generationError('PDB_DELTA_INPUT', 'PDB delta method document does not match its sequence points');
    }
    builder.add(31, [token(49, method.token & 0xffffff)]);
    builder.add(49, [document, builder.blob(writeSequencePoints(points, document, method.localSignature))]);
    if (method.scopes.length) writeMethodScopes(builder, { ...method, token: mappedMethod(method.token) },
      { code: { length: method.codeSize } }, counts);
  }
  writeStateMachines(builder, input.stateMachines.map((record) => ({
    ...record, moveNext: mappedMethod(record.moveNext),
  })), counts);
  const custom = input.custom.map((record) => ({
    ...record, parent: record.parent >>> 24 === 6 ? mappedMethod(record.parent) : record.parent,
  }));
  appendCustomRecords(builder, custom, counts, customRows);
  input.budget.check();
  const emitted = finishPortablePdb(builder, deltaCounts, 0, true);
  if (emitted.bytes.length > input.budget.limits.maxBytes) generationError('PDB_DELTA_BUDGET', 'PDB delta output byte limit exceeded');
  // Run the shared reference/codec checks before returning bytes to a Hot Reload producer.
  readPortablePdbDelta(emitted.bytes, { typeSystemRowCounts: counts, signal: options.signal });
  return { ...emitted, baselineId, previousPdbId, generation: generation.generation,
    pdbId: hex(emitted.id), typeSystemRowCounts: counts, deltaRowCounts: deltaCounts };
}

/** Emit changed-method PDB rows and a caller-verifiable baseline envelope. This does not emit or apply CLI/IL deltas. */
export function emitPortablePdbDelta(debug, generation, options = {}) {
  try {
    if (!options || typeof options !== 'object') generationError('PDB_DELTA_INPUT', 'Invalid PDB delta writer options');
    return serialize(debug, generation, options);
  } catch (error) {
    if (error instanceof CilError) generationError('PDB_DELTA_INPUT', `Invalid PDB delta: ${error.message}`);
    throw error;
  }
}
