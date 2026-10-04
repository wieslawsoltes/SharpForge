import { readMetadata } from './reader.js';
import { readPortableExecutable } from '../pe/reader.js';
import { decodeCoded, metadataCodedIndices, metadataIndexWidth } from './indices.js';
import { metadataColumnKind, metadataLists } from './pointer-tables.js';
import { tableDefinitions } from './tables.js';
import { generationMap } from './delta-map.js';
import { generationHeapState, generationHeapEntry, validateGenerationHeapReference } from './delta-heaps.js';
import { generationError, generationToken, GenerationQuery } from './delta-contracts.js';

const heapColumns = Object.freeze({ str: '#Strings', guid: '#GUID', blob: '#Blob' });
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const inputBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get;
const inputOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset').get;
const inputLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength').get;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;

function inputExtent(input) {
  if (!(input instanceof Uint8Array)) generationError('MD_GEN_INPUT', 'Metadata generation input must be a Uint8Array');
  try {
    const buffer = inputBuffer.call(input), offset = inputOffset.call(input), length = inputLength.call(input);
    bufferLength.call(buffer); // Intrinsic ArrayBuffer admission excludes shared backing buffers, including other realms.
    if (bufferResizable?.call(buffer)) throw new TypeError('Resizable metadata generation input');
    new Uint8Array(buffer, offset, length); // Also rejects an already detached buffer when its reported extent is zero.
    return { buffer, offset, length };
  } catch (error) {
    generationError('MD_GEN_INPUT', 'Metadata generation input needs an attached, unshared, nonresizable ArrayBuffer', error);
  }
}

function ownInput(input, state, operation) {
  operation.check();
  const extent = inputExtent(input);
  if (extent.length > state.limits.maxInputBytes || extent.length + state.byteCount > state.limits.maxRetainedBytes) {
    generationError('MD_GEN_BUDGET', 'Metadata generation input or retained byte budget exceeded');
  }
  if (state.entries.length >= state.limits.maxGenerations) generationError('MD_GEN_BUDGET', 'Metadata generation count exceeded');
  const bytes = new Uint8Array(extent.length);
  for (let offset = 0; offset < extent.length; offset += 65536) {
    operation.check();
    let chunk;
    try { chunk = new Uint8Array(extent.buffer, extent.offset + offset, Math.min(65536, extent.length - offset)); }
    catch (error) { generationError('MD_GEN_INPUT', 'Metadata generation input was detached during copying', error); }
    bytes.set(chunk, offset);
  }
  return bytes;
}

function physicalReader(bytes, format, state, operation) {
  const metadataOptions = { maxRows: state.limits.maxRetainedRecords - state.recordCount, signal: operation.signal };
  try {
    if (format === 'pe') {
      const pe = readPortableExecutable(bytes, { maxBytes: state.limits.maxInputBytes, inspection: true, metadataOptions });
      return { metadata: pe.metadata, metadataOffset: pe.metadataOffset };
    }
    return { metadata: readMetadata(bytes, metadataOptions), metadataOffset: 0 };
  } catch (error) {
    if (error.code === 'MD_READ_CANCELED') generationError('MD_GEN_CANCELED', 'Metadata generation reading canceled', error);
    if (error.code === 'MD_READ_ROW_LIMIT') generationError('MD_GEN_BUDGET', 'Metadata generation retained row budget exceeded', error);
    generationError('MD_GEN_FORMAT', 'Invalid physical metadata generation', error);
  }
}

function checkFormat(metadata, generation) {
  if (metadata.streams.has('#Pdb') || Object.keys(metadata.counts).some(table => Number(table) > 44)) {
    generationError('MD_GEN_FORMAT', 'CLI generation history does not accept Portable PDB or unknown tables');
  }
  if (metadata.counts[0] !== 1) generationError('MD_GEN_FORMAT', 'CLI generation needs exactly one Module row');
  if (generation === 0) {
    if (metadata.minimalDelta || metadata.counts[30] || metadata.counts[31] || !metadata.counts[2]) {
      generationError('MD_GEN_FORMAT', 'CLI baseline must be complete metadata without EnC control records');
    }
  } else if (!metadata.minimalDelta || !metadata.uncompressed) {
    generationError('MD_GEN_FORMAT', 'CLI delta requires minimal uncompressed metadata');
  }
}

function guidIdentity(metadata, index) {
  try { return Array.from(metadata.guid(index), value => value.toString(16).padStart(2, '0')).join(''); }
  catch (error) { generationError('MD_GEN_IDENTITY', 'Invalid physical Module GUID handle', error); }
}

function identity(entries, entry, operation) {
  const row = entry.metadata.rows[0][0], previous = entries[entry.generation - 1];
  const mvid = guidIdentity(entry.metadata, row[2]);
  const generationId = guidIdentity(entry.metadata, row[3]), previousGenerationId = guidIdentity(entry.metadata, row[4]);
  const name = generationHeapEntry(entries, '#Strings', row[1], entry.generation, operation).value;
  if (row[0] !== entry.generation || !name || /^0+$/.test(mvid)) {
    generationError('MD_GEN_IDENTITY', 'Invalid Module generation number, name or MVID');
  }
  if (previous) {
    if (mvid !== entries[0].identity.mvid || name !== entries[0].identity.name ||
        previousGenerationId !== previous.identity.generationId || /^0+$/.test(generationId) ||
        entries.slice(0, -1).some(value => value.identity.generationId === generationId)) {
      generationError('MD_GEN_IDENTITY', 'Module identity or previous generation ID does not match');
    }
  } else if (!/^0+$/.test(previousGenerationId)) {
    generationError('MD_GEN_IDENTITY', 'A baseline has no previous generation ID');
  }
  return { mvid, name, generationId, previousGenerationId };
}

function checkReference(entries, entry, table, column, value) {
  if (value === 0) return;
  const kind = metadataColumnKind(table, column, entry.counts, entry.metadata.uncompressed);
  const heap = heapColumns[kind];
  if (heap) {
    validateGenerationHeapReference(entries, heap, value, entry.generation);
  } else if (kind.startsWith('t')) {
    const target = Number(kind.slice(1)), extra = metadataLists[`${table}:${column}`] ? 1 : 0;
    if (value > (entry.counts[target] ?? 0) + extra) generationError('MD_GEN_REFERENCE', 'Table index exceeds aggregate row count');
  } else if (metadataCodedIndices[kind]) {
    const token = decodeCoded(kind, value);
    if ((token & 0xffffff) > (entry.counts[token >>> 24] ?? 0)) generationError('MD_GEN_REFERENCE', 'Coded index exceeds aggregate row count');
  }
}

function rowFacts(entries, entry, operation) {
  const rowWidths = {};
  let recordCount = 0;
  for (const [key, rows] of Object.entries(entry.metadata.rows)) {
    const table = Number(key), definition = tableDefinitions[table];
    recordCount += rows.length;
    rowWidths[table] = definition.types.reduce((size, _, column) => size + metadataIndexWidth(
      metadataColumnKind(table, column, entry.metadata.counts, entry.metadata.uncompressed),
      entry.metadata.counts, entry.metadata.heapFlags, entry.metadata.minimalDelta), 0);
    for (let index = 0; index < rows.length; index++) {
      if ((index & 255) === 0) operation.check();
      if (table === 31) continue;
      if (table === 30) {
        const value = generationToken(rows[index][0]);
        if ((value & 0xffffff) > (entry.counts[value >>> 24] ?? 0)) generationError('MD_GEN_REFERENCE', 'EncLog entity is unavailable');
        continue;
      }
      try {
        for (let column = 0; column < definition.types.length; column++) {
          checkReference(entries, entry, table, column, rows[index][column]);
        }
      } catch (error) {
        generationError('MD_GEN_REFERENCE', 'Raw metadata row references an unavailable entity or heap slot', error);
      }
    }
  }
  return { recordCount, rowWidths };
}

/** Prepare an owned generation completely; the caller publishes it only after this function succeeds. */
export function prepareMetadataGeneration(input, state, options) {
  const operation = new GenerationQuery({ signal: options.signal, maxEntryBytes: 65536, maxPageBytes: 65536 });
  const bytes = ownInput(input, state, operation), generation = state.entries.length;
  const { metadata, metadataOffset } = physicalReader(bytes, options.format, state, operation);
  checkFormat(metadata, generation);
  const previous = state.entries.at(-1);
  const mapping = previous ? generationMap(metadata, previous, operation)
    : { counts: { ...metadata.counts }, updates: {}, localToAggregate: {} };
  const entry = { generation, bytes, metadata, metadataOffset, ...mapping, ...generationHeapState(metadata, previous, operation) };
  const entries = [...state.entries, entry];
  entry.identity = identity(entries, entry, operation);
  Object.assign(entry, rowFacts(entries, entry, operation));
  operation.check();
  return entry;
}
