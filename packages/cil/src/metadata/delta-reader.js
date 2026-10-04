import { tableDefinitions } from './tables.js';
import { token } from './indices.js';
import { prepareMetadataGeneration } from './delta-input.js';
import { aggregateGenerationToken, mapGenerationEntity } from './delta-map.js';
import { generationHeapKinds, generationHeapNames, generationHeapEntry, mapGenerationHeap } from './delta-heaps.js';
import { commitMetadataGeneration, generationRowRecord, selectedGenerationRow } from './delta-rows.js';
import { GenerationQuery, generationError, generationInteger, generationLimits, generationOptions,
  generationPage, generationTable, generationToken } from './delta-contracts.js';

export { metadataGenerationDiagnosticCatalog } from './delta-contracts.js';

/** Owned baseline/delta CLI records and heaps; this view neither reconstructs list ownership nor applies runtime updates. */
export class MetadataGenerations {
  #state;
  #revisions = new Map();
  #appending = false;

  constructor(baseline, options = {}) {
    generationOptions(options);
    const format = options.format ?? 'metadata';
    if (format !== 'metadata' && format !== 'pe') generationError('MD_GEN_INPUT', 'Unknown baseline metadata format');
    this.#state = { entries: [], limits: generationLimits(options), byteCount: 0, recordCount: 0 };
    const entry = prepareMetadataGeneration(baseline, this.#state, { format, signal: options.signal });
    commitMetadataGeneration(this.#state, this.#revisions, entry);
  }

  #current() {
    if (!this.#state) generationError('MD_GEN_DISPOSED', 'Metadata generation history is disposed');
    return this.#state;
  }

  #generation(value) {
    return generationInteger(value === undefined ? this.generation : value, 'requested generation', this.generation);
  }

  get generation() { return this.#current().entries.length - 1; }
  get identity() { return { ...this.#current().entries.at(-1).identity }; }
  get counts() { return { ...this.#current().entries.at(-1).counts }; }
  get retainedBytes() { return this.#current().byteCount; }
  get retainedRecords() { return this.#current().recordCount; }

  /** Append one immediately following minimal metadata root; rejection leaves the complete prior history intact. */
  append(bytes, options = {}) {
    const state = this.#current();
    if (this.#appending) generationError('MD_GEN_INPUT', 'Metadata generation append is already in progress');
    this.#appending = true;
    try {
      generationOptions(options);
      const generation = generationInteger(options.generation, 'append generation', 1023, 1);
      if (generation !== state.entries.length) generationError('MD_GEN_IDENTITY', 'Metadata append generation is not the immediate successor');
      const entry = prepareMetadataGeneration(bytes, state, { format: 'metadata', signal: options.signal });
      if (this.#state !== state) generationError('MD_GEN_DISPOSED', 'Metadata history was disposed during append');
      commitMetadataGeneration(state, this.#revisions, entry);
      return entry.generation;
    } finally {
      this.#appending = false;
    }
  }

  /** Map an aggregate entity/heap handle to its introducing generation, matching SRM's separate mapping operation. */
  getGenerationHandle(handle, options = {}) {
    const state = this.#current(), operation = new GenerationQuery(options);
    const generation = this.#generation(options.generation);
    if (!handle || typeof handle !== 'object' || Array.isArray(handle)) generationError('MD_GEN_INPUT', 'Expected a metadata handle object');
    let result;
    if (handle.kind === 'entity') result = mapGenerationEntity(state.entries, handle.value, generation);
    else if (Object.hasOwn(generationHeapKinds, handle.kind)) {
      result = mapGenerationHeap(state.entries, generationHeapKinds[handle.kind], handle.value, generation);
    } else generationError('MD_GEN_FORMAT', 'Only ordinary CLI entity and heap handles are supported');
    operation.check();
    return result;
  }

  /** Inverse physical entity mapping; sourceGeneration is the generation containing the local table row. */
  getAggregateToken(localToken, sourceGeneration, options = {}) {
    const state = this.#current(), operation = new GenerationQuery(options);
    const result = aggregateGenerationToken(state.entries[this.#generation(sourceGeneration)], localToken);
    operation.check();
    return result;
  }

  row(value, options = {}) {
    const state = this.#current(), operation = new GenerationQuery(options);
    generationToken(value);
    return selectedGenerationRow(state, this.#revisions, value, this.#generation(options.generation), operation);
  }

  rows(table, options = {}) {
    const state = this.#current(), operation = new GenerationQuery(options);
    const definition = generationTable(table), generation = this.#generation(options.generation);
    const { end, ...page } = generationPage(options, state.entries[generation].counts[definition.id] ?? 0);
    const rows = [];
    for (let index = page.offset; index < end; index++) {
      rows.push(selectedGenerationRow(state, this.#revisions, token(definition.id, index + 1), generation, operation));
    }
    return { table: definition.id, name: definition.name, generation, ...page, rows };
  }

  tables(options = {}) {
    const state = this.#current(), operation = new GenerationQuery(options);
    const generation = this.#generation(options.generation), result = [];
    const includeEmpty = options.includeEmpty ?? true;
    if (typeof includeEmpty !== 'boolean') generationError('MD_GEN_INPUT', 'Invalid includeEmpty option');
    for (const definition of Object.values(tableDefinitions)) {
      if (definition.id > 44 || definition.id === 30 || definition.id === 31) continue;
      const rowCount = state.entries[generation].counts[definition.id] ?? 0;
      if (!includeEmpty && !rowCount) continue;
      operation.charge(64 + definition.columns.reduce((size, name) => size + name.length * 2, 0));
      result.push({ table: definition.id, name: definition.name, generation, rowCount,
        columns: [...definition.columns], kinds: [...definition.types] });
    }
    return result;
  }

  controlRows(table, options = {}) {
    const state = this.#current(), operation = new GenerationQuery(options);
    const definition = generationTable(table, true), generation = this.#generation(options.generation);
    if (definition.id !== 30 && definition.id !== 31) generationError('MD_GEN_CONTROL', 'controlRows accepts only EncLog or EncMap');
    const entry = state.entries[generation];
    const { end, ...page } = generationPage(options, entry.metadata.counts[definition.id] ?? 0);
    const rows = [];
    for (let index = page.offset; index < end; index++) {
      rows.push(generationRowRecord(entry, token(definition.id, index + 1), null, operation));
    }
    return { table: definition.id, name: definition.name, generation, ...page, rows };
  }

  heapEntry(name, index, options = {}) {
    const state = this.#current(), operation = new GenerationQuery(options);
    return generationHeapEntry(state.entries, name, index, this.#generation(options.generation), operation);
  }

  heaps(options = {}) {
    const state = this.#current(), operation = new GenerationQuery(options);
    const generation = this.#generation(options.generation), result = [];
    for (const name of generationHeapNames) {
      const segments = [];
      for (let index = 0; index <= generation; index++) {
        operation.charge(64);
        const entry = state.entries[index];
        segments.push({ generation: index, physicalBytes: entry.metadata.streams.get(name)?.length ?? 0,
          logicalBytes: entry.heapSizes[name], aggregateStart: index ? state.entries[index - 1].heapTotals[name] : 0,
          aggregateEnd: entry.heapTotals[name] });
      }
      result.push({ heap: name, generation, units: name === '#GUID' ? 'guid-index' : 'byte-offset',
        aggregateSize: state.entries[generation].heapTotals[name], segments });
    }
    return result;
  }

  /** Release owned history; previously returned row/heap facts remain independent and usable. */
  dispose() {
    this.#state = null;
    this.#revisions.clear();
  }
}
