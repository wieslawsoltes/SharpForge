import { MetadataBuilder, Writer, metadataSchemas, readMetadata, token } from '@sharpforge/cil';

const encoder = new TextEncoder();

/** Authored minimal metadata serializer for negative/boundary tests; never native qualification. */
export function serializeCliDelta(rows, heaps, options = {}) {
  const mask = Object.keys(rows).reduce((value, table) => value | 1n << BigInt(table), 0n);
  const tables = new Writer().u32(0).u8(2).u8(0).u8(options.heapFlags ?? 0).u8(1)
    .u32(Number(mask & 0xffffffffn)).u32(Number(mask >> 32n)).u32(0).u32(0);
  for (const records of Object.values(rows)) tables.u32(records.length);
  for (const [table, records] of Object.entries(rows)) {
    for (const row of records) row.forEach((value, column) => {
      if (metadataSchemas[table][column] === 'u16') tables.u16(value);
      else tables.u32(value);
    });
  }
  const streams = [[options.tableStream ?? '#-', tables.finish()], ...heaps,
    ['#JTD', options.marker ?? new Uint8Array()]];
  const version = encoder.encode('v4.0.30319\0\0');
  const root = new Writer().u32(0x424a5342).u16(1).u16(1).u32(0).u32(version.length)
    .bytes(version).u16(0).u16(streams.length);
  const offsets = [];
  for (const [name, bytes] of streams) {
    offsets.push(root.length);
    root.u32(0).u32(bytes.length).bytes(encoder.encode(name)).u8(0).pad();
  }
  streams.forEach(([, bytes], index) => {
    root.pad();
    root.patch32(offsets[index], root.length);
    root.bytes(bytes);
  });
  return root.finish();
}

function logicalStrings(bytes) {
  let end = bytes.length - 1;
  while (end >= 0 && bytes[end] === 0) end--;
  return bytes.length && end < bytes.length - 1 ? end + 2 : bytes.length;
}

function totals(metadata, previous = {}) {
  return Object.fromEntries(['#Strings', '#Blob', '#GUID', '#US'].map(name => {
    const bytes = metadata.streams.get(name);
    const size = name === '#Strings' ? logicalStrings(bytes) : name === '#GUID' ? bytes.length / 16 : bytes.length;
    return [name, (previous[name] ?? 0) + size];
  }));
}

function delta(generation, baseline, previous, previousId) {
  const builder = new MetadataBuilder('AggregateFixture');
  const string = value => previous['#Strings'] + builder.string(value);
  const blob = value => previous['#Blob'] + builder.blob(Uint8Array.from(value));
  const id = new Uint8Array(16).fill(generation * 17);
  const guidCount = previous['#GUID'] + (generation === 1 ? 2 : 3);
  const guids = new Uint8Array(guidCount * 16);
  guids.set(baseline.guid(1), previous['#GUID'] * 16);
  guids.set(id, (previous['#GUID'] + 1) * 16);
  if (previousId) guids.set(previousId, (previous['#GUID'] + 2) * 16);
  const firstMethod = generation === 1 ? 1 : 2;
  const rows = {
    0: [[generation, string('AggregateFixture.dll'), previous['#GUID'] + 1, previous['#GUID'] + 2,
      generation === 1 ? 0 : previous['#GUID'] + 3]],
    6: [[4, 0, 150, string(generation === 1 ? 'Old' : 'Added'), blob([0, 0, 1]), 0],
      [8, 0, 150, string(generation === 1 ? 'Added' : 'AddedAgain'), blob([0, 0, 1]), 0]],
    17: [[blob([7, 1, 8])]],
    26: [[string(generation === 1 ? 'new.netmodule' : 'existing.netmodule')]],
  };
  const mapping = [token(6, firstMethod), token(6, firstMethod + 1), token(17, generation), token(26, generation === 1 ? 2 : 1)];
  rows[30] = [[token(2, 2), 1], ...mapping.map(value => [value, 0])];
  rows[31] = mapping.map(value => [value]);
  const userString = previous['#US'] + builder.userString(generation === 1 ? 'first delta λ' : 'second delta 😀');
  const heaps = builder.heaps.finish(baseline.guid(1)).map(([name, bytes]) => [name, name === '#GUID' ? guids : bytes]);
  const bytes = serializeCliDelta(rows, heaps);
  return { bytes, id, userString, rows, heaps, totals: totals(readMetadata(bytes), previous) };
}

export function cliGenerationFixture(options = {}) {
  const builder = new MetadataBuilder('AggregateFixture', options);
  builder.add(2, [0, builder.string('<Module>'), 0, 0, 1, 1]);
  builder.add(2, [1, builder.string('Fixture'), 0, 0, 1, 1]);
  builder.add(6, [8192, 0, 150, builder.string('Old'), builder.blob(Uint8Array.from([0, 0, 1])), 1]);
  builder.add(26, [builder.string('existing.netmodule')]);
  const userString = builder.userString('baseline');
  const bytes = builder.finish(), metadata = readMetadata(bytes);
  const first = delta(1, metadata, totals(metadata));
  const second = delta(2, metadata, first.totals, first.id);
  return { baseline: bytes, metadata, userString, deltas: [first, second] };
}

export function editCliDelta(bytes, edit) {
  const metadata = readMetadata(bytes);
  const rows = Object.fromEntries(Object.entries(metadata.rows).map(([table, records]) => [table, records.map(row => [...row])]));
  const heaps = [...metadata.streams].filter(([name]) => name !== '#-' && name !== '#JTD')
    .map(([name, data]) => [name, new Uint8Array(data)]);
  const options = {};
  edit(rows, heaps, options);
  return serializeCliDelta(rows, heaps, options);
}
