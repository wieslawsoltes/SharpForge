import { Writer, metadataSchemas, token, codedIndex } from '@sharpforge/cil';
import { PortablePdbBuilder, PdbGuids, writeSequencePoints, sha256 } from '@sharpforge/symbols';

export const aggregateCounts = { 0: 1, 6: 3, 17: 7 };
export const updatedToken = token(6, 2);
export function sequencePoint(line) {
  return { offset: 0, document: 1, startLine: line, endLine: line, startColumn: 1, endColumn: 5 };
}

function document(builder) {
  const name = builder.blob(new TextEncoder().encode('Generation.cs'));
  builder.add(48, [builder.blob(new Writer().u8(47).compressed(name).finish()), 0, 0, 0]);
}

export function baselineFixture() {
  const builder = new PortablePdbBuilder();
  document(builder);
  for (let row = 1; row <= 3; row++) builder.add(49, [1, builder.blob(writeSequencePoints([sequencePoint(row)], 1))]);
  return builder.finish({ 0: 1, 6: 3, 17: 6 }, 0).bytes;
}

/** Independent SRM-format fixture serializer; this is constructed data, never native qualification. */
export function serializeDelta(builder, counts = { 0: 1, 6: 1, 17: 1 }) {
  let present = 0n;
  let external = 0n;
  for (const table of Object.keys(builder.rows)) present |= 1n << BigInt(table);
  for (const table of Object.keys(counts)) external |= 1n << BigInt(table);
  const pdb = new Writer().zero(20).u32(0).u32(Number(external & 0xffffffffn)).u32(Number(external >> 32n));
  for (const count of Object.values(counts)) pdb.u32(count);
  const tables = new Writer().u32(0).u8(2).u8(0).u8(7).u8(1)
    .u32(Number(present & 0xffffffffn)).u32(Number(present >> 32n)).u32(0).u32(0);
  for (const rows of Object.values(builder.rows)) tables.u32(rows.length);
  for (const [table, rows] of Object.entries(builder.rows)) {
    for (const row of rows) row.forEach((value, column) => {
      if (metadataSchemas[table][column] === 'u16') tables.u16(value);
      else tables.u32(value);
    });
  }
  const streams = [
    ['#Pdb', pdb.finish()], ['#-', tables.finish()], ['#Strings', builder.strings.finish()],
    ['#GUID', builder.guids.finish()], ['#Blob', builder.blobs.finish()], ['#JTD', new Uint8Array()],
  ];
  const root = new Writer().u32(0x424a5342).u16(1).u16(1).u32(0).u32(12)
    .bytes(new TextEncoder().encode('PDB v1.0\0\0\0\0')).u16(0).u16(streams.length);
  const positions = [];
  for (const [name, bytes] of streams) {
    positions.push(root.length);
    root.u32(0).u32(bytes.length).bytes(new TextEncoder().encode(name)).u8(0).pad();
  }
  let pdbOffset;
  streams.forEach(([name, bytes], index) => {
    root.pad();
    root.patch32(positions[index], root.length);
    if (name === '#Pdb') pdbOffset = root.length;
    root.bytes(bytes);
  });
  const bytes = root.finish();
  bytes.set(sha256(bytes).subarray(0, 20), pdbOffset);
  return bytes;
}

export function deltaFixture(change = () => {}) {
  const builder = new PortablePdbBuilder();
  document(builder);
  builder.add(31, [token(49, 2)]);
  builder.add(49, [1, builder.blob(writeSequencePoints([sequencePoint(102)], 1, 7))]);
  builder.add(50, [1, 0, 1, 1, 0, 4]);
  builder.add(51, [0, 0, builder.string('updated')]);
  builder.add(54, [1, 3]);
  builder.add(55, [
    codedIndex('HasCustomDebugInformation', token(6, 1)), builder.guid(PdbGuids.asyncSteps),
    builder.blob(new Writer().u32(0).u32(0).u32(1).compressed(2).finish()),
  ]);
  const counts = { 0: 1, 6: 1, 17: 1 };
  change(builder, counts);
  return serializeDelta(builder, counts);
}
