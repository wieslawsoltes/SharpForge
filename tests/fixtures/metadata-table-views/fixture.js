import { MetadataBuilder, Writer, metadataSchemas, writePE } from '@sharpforge/cil';
import { PortablePdbBuilder } from '@sharpforge/symbols';
import { metadataFixture } from '../a03-metadata/fixture.js';

/** All 45 CLI tables by default; native probes can select legacy tables that SRM rejects. */
export function tablesFixture({ legacyTables = [33, 34, 36, 37] } = {}) {
  const fixture = metadataFixture();
  const { builder } = fixture;
  builder.uncompressed = true;
  for (const [pointer, target] of [[3, 4], [5, 6], [7, 8], [19, 20], [22, 23]]) {
    for (let index = 0; index < builder.rows[target].length; index++) builder.add(pointer, [index + 1]);
  }
  builder.add(30, [fixture.owner, 0]);
  builder.add(31, [fixture.owner]);
  const legacyRows = { 33: [0x8664], 34: [4, 6, 0], 36: [0x8664, 1], 37: [4, 6, 0, 1] };
  for (const table of legacyTables) builder.add(table, legacyRows[table]);
  const string = builder.string('SuffixName');
  const blob = builder.blob(new Uint8Array([0, 127, 128, 255]));
  const guid = builder.guid(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
  const emptyString = builder.userString('');
  const userString = builder.userString('A\0𝄞');
  const metadata = builder.finish();
  const section = new Writer().zero(72).bytes(metadata).finish();
  return { ...fixture, metadata, bytes: writePE(section, 72, metadata.length, 0),
    probes: { '#Strings': [0, string, string + 6], '#Blob': [0, blob], '#GUID': [0, 1, guid],
      '#US': [emptyString, userString] } };
}

/** Eight Portable PDB tables, with wide external method indexes but no local MethodDef table. */
export function pdbTablesFixture(methods = 65536) {
  const builder = new PortablePdbBuilder();
  const name = builder.blob(new Uint8Array([47, 0]));
  const guid = builder.guid('04030201-0605-0807-090a-0b0c0d0e0f10');
  const signature = builder.blob(new Uint8Array([8, 1, 0, 0, 0]));
  builder.add(48, [name, guid, 0, guid]);
  for (let index = 0; index < methods; index++) builder.add(49, [1, 0]);
  builder.add(50, [methods, 1, 1, 1, 0, 1]);
  builder.add(51, [0, 0, builder.string('local')]);
  builder.add(52, [builder.string('constant'), signature]);
  builder.add(53, [0, 0]);
  builder.add(54, [methods, 1]);
  builder.add(55, [methods * 32, guid, signature]);
  const { bytes } = builder.finish({ 6: methods }, 0);
  return { builder, bytes, probes: { '#Strings': [0], '#Blob': [0, signature], '#GUID': [0, guid] } };
}

export function heapFixture() {
  const builder = new MetadataBuilder('HeapViews');
  const string = builder.string('prefix-suffix');
  const blobs = [0, 127, 128, 16383, 16384].map(length => builder.blob(new Uint8Array(length).fill(42)));
  const guid = builder.guid(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
  const userStrings = ['', 'A\0𝄞', '\ud800\udc00\ud800'].map(value => ({ value, index: builder.userString(value) }));
  return { builder, string, blobs, guid, userStrings };
}

/** Deliberate local/aggregate handle aliases: projection must not guess their semantic generation. */
export function deltaTablesFixture() {
  const rows = { 31: [[0x31000001]], 48: [[1, 1, 1, 1]], 49: [[1, 1]],
    50: [[1, 1, 1, 1, 4, 8]], 51: [[0xabcd, 0x1234, 1]], 55: [[32, 1, 1]] };
  const mask = Object.keys(rows).reduce((value, table) => value | 1n << BigInt(table), 0n);
  const tables = new Writer().u32(0).u8(2).u8(0).u8(0).u8(1)
    .u32(Number(mask & 0xffffffffn)).u32(Number(mask >> 32n)).u32(0).u32(0);
  for (const records of Object.values(rows)) tables.u32(records.length);
  for (const [table, records] of Object.entries(rows)) {
    for (const row of records) row.forEach((value, column) => {
      if (metadataSchemas[table][column] === 'u16') tables.u16(value);
      else tables.u32(value);
    });
  }
  const streams = [['#-', tables.finish()], ['#JTD', new Uint8Array()],
    ['#Strings', new Uint8Array([0, 65, 0])], ['#Blob', new Uint8Array([0, 1, 42])],
    ['#GUID', Uint8Array.from({ length: 16 }, (_, index) => index + 1)]];
  const root = new Writer().u32(0x424a5342).u16(1).u16(1).u32(0).u32(4)
    .bytes(new Uint8Array([118, 49, 0, 0])).u16(0).u16(streams.length);
  const offsets = [];
  for (const [name, bytes] of streams) {
    offsets.push(root.length);
    root.u32(0).u32(bytes.length).bytes(new TextEncoder().encode(name)).u8(0).pad();
  }
  streams.forEach(([, bytes], index) => {
    root.pad();
    root.patch32(offsets[index], root.length);
    root.bytes(bytes);
  });
  return root.finish();
}
