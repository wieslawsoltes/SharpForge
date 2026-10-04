import { decodeCoded, MetadataGenerations, metadataIndexWidth, metadataSchemas, readMetadata, readPE,
  tableDefinitions, Writer } from '@sharpforge/cil';

const heaps = Object.freeze({ string: '#Strings', blob: '#Blob', guid: '#GUID', userString: '#US' });
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');

function rejected(action, code, equal, label) {
  let failure;
  try { action(); } catch (error) { failure = error; }
  equal(failure?.code, code, label);
}

function checkRow(reader, sources, expected, equal, options = {}) {
  const actual = options.control
    ? reader.controlRows(expected.localToken >>> 24, { generation: expected.generation, offset: (expected.localToken & 0xffffff) - 1, limit: 1 }).rows[0]
    : reader.row(expected.token, { generation: options.generation });
  for (const key of ['generation', 'localToken', 'metadataOffset', 'byteLength']) equal(actual[key], expected[key], key);
  const source = sources[actual.generation], metadata = source.metadata;
  equal(hex(source.bytes.subarray(actual.sourceOffset, actual.sourceOffset + actual.byteLength)), expected.bytes, 'physical row bytes');
  if (expected.fields) for (const [name, value] of Object.entries(expected.fields)) {
    equal(actual.values[tableDefinitions[actual.table].columns.indexOf(name)], value, name);
  }
  if (expected.references) for (const [name, value] of Object.entries(expected.references)) {
    const column = tableDefinitions[actual.table].columns.indexOf(name);
    equal(decodeCoded(metadataSchemas[actual.table][column], actual.values[column]), value, name + ' entity');
  }
  // The public schema/sizing encoder compares every returned scalar with native physical bytes, including baseline list columns.
  const writer = new Writer();
  actual.values.forEach((value, column) => {
    const width = metadataIndexWidth(metadataSchemas[actual.table][column], metadata.counts, metadata.heapFlags, metadata.minimalDelta);
    if (width === 2) writer.u16(value);
    else writer.u32(value);
  });
  equal(hex(writer.finish()), expected.bytes, 'raw physical scalar round trip');
  if (!options.control) {
    equal(actual.token, expected.token, 'aggregate row token');
    equal(reader.getAggregateToken(actual.localToken, actual.generation), expected.token, 'inverse physical row mapping');
  }
  return actual;
}

function checkHeap(reader, expected, equal, totals) {
  const handle = { kind: expected.kind, value: expected.value };
  if (!expected.success) {
    rejected(() => reader.getGenerationHandle(handle), 'MD_GEN_HEAP', equal, 'native future heap handle');
    return;
  }
  equal(reader.getGenerationHandle(handle), { ...handle, generation: expected.generation, localValue: expected.localValue }, 'native heap mapping');
  totals.heapMappings++;
  // Nil value conventions are documented independently from the exact native mapping.
  if (expected.value === 0) return;
  if (!expected.readSuccess || (expected.kind === 'userString' && expected.userStringStatus !== 'valid')) {
    rejected(() => reader.heapEntry(heaps[expected.kind], expected.value), 'MD_GEN_HEAP', equal, 'unreadable/strict heap boundary');
    if (expected.readSuccess) totals.strictUserStringBoundaries++;
    return;
  }
  const actual = reader.heapEntry(heaps[expected.kind], expected.value);
  const value = actual.value instanceof Uint8Array ? hex(actual.value) : actual.value;
  equal(value, expected.heapValue, 'native heap value');
  totals.heapValues++;
}

/** Shared Node/browser replay; assertions are supplied by the host and every comparison consumes native observations. */
export function replayMetadataGenerations(native, inputs, equal) {
  const sources = inputs.map((bytes, generation) => ({ bytes,
    metadata: generation ? readMetadata(bytes) : readPE(bytes, { inspection: true }).metadata }));
  equal(sources[0].metadata.uncompressed, false, 'The native fixture baseline uses ordinary compressed metadata');
  const reader = new MetadataGenerations(inputs[0], { format: 'pe' });
  const totals = { generations: 0, rows: 0, historicalRows: 0, entityMappings: 0, heapMappings: 0,
    heapValues: 0, strictUserStringBoundaries: 0 };
  for (const generation of native.generations) {
    if (generation.generation) reader.append(inputs[generation.generation], { generation: generation.generation });
    equal(reader.generation, generation.generation, 'generation');
    const counts = Object.fromEntries(Object.entries(reader.counts).filter(([, count]) => count));
    equal(counts, generation.counts, 'native aggregate counts');
    for (const key of ['mvid', 'generationId', 'previousGenerationId']) equal(reader.identity[key], generation.identity[key], key);
    equal(reader.controlRows(31).rows.map(row => row.values[0]), generation.mapping, 'native EncMap');
    equal(reader.controlRows(30).rows.map(row => ({ token: row.values[0], operation: row.values[1] })), generation.log, 'native EncLog');
    for (const expected of generation.mergedRows) { checkRow(reader, sources, expected, equal); totals.rows++; }
    for (const expected of generation.physical.filter(row => [30, 31].includes(row.localToken >>> 24))) {
      checkRow(reader, sources, expected, equal, { control: true });
    }
    for (const expected of generation.entityMappings) {
      const handle = { kind: 'entity', value: expected.value };
      if (!expected.success) rejected(() => reader.getGenerationHandle(handle), 'MD_GEN_TOKEN', equal, 'native future entity handle');
      else {
        equal(reader.getGenerationHandle(handle), { ...handle, generation: expected.generation, localValue: expected.localValue }, 'native entity mapping');
        if (expected.value & 0xffffff) {
          equal(reader.getAggregateToken(expected.localValue, expected.generation), expected.value, 'native inverse entity mapping');
        }
        totals.entityMappings++;
      }
    }
    for (const expected of generation.heapMappings) checkHeap(reader, expected, equal, totals);
    for (const actual of reader.heaps()) {
      const kind = Object.keys(heaps).find(kind => heaps[kind] === actual.heap);
      equal(actual.aggregateSize, generation.heapTotals[kind], 'native aggregate heap size');
      equal(actual.segments.at(-1).logicalBytes, generation.heapSizes[kind], 'native logical heap size');
    }
    totals.generations++;
  }
  for (const generation of native.generations.slice(0, -1)) {
    for (const expected of generation.mergedRows) {
      checkRow(reader, sources, expected, equal, { generation: generation.generation });
      totals.historicalRows++;
    }
  }
  return { reader, totals };
}
