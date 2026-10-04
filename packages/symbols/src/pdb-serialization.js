import { Writer, utf8, metadataIndexWidth, metadataSchemas } from '@sharpforge/cil';
import { sha256 } from './hash.js';
import { generationError } from './pdb-delta-format.js';

function tableStream(builder, external, delta) {
  const counts = { ...external, ...Object.fromEntries(Object.entries(builder.rows).map(([table, rows]) => [table, rows.length])) };
  const flags = delta ? 7 :
    (builder.strings.length >= 65536 ? 1 : 0) |
    (builder.guids.length >= 65536 ? 2 : 0) |
    (builder.blobs.length >= 65536 ? 4 : 0);
  const tables = new Writer().u32(0).u8(2).u8(0).u8(flags).u8(1);
  let high = 0;
  let low = 0;
  for (const key of Object.keys(builder.rows)) {
    const table = Number(key);
    if (table < 32) low |= 1 << table;
    else high |= 1 << (table - 32);
  }
  tables.u32(low).u32(high).u32(0).u32((1 << 18) | (1 << 22) | (1 << 23));
  const start = delta ? 31 : 48;
  for (let table = start; table <= 55; table++) if (builder.rows[table]) tables.u32(builder.rows[table].length);
  for (let table = start; table <= 55; table++) {
    for (const row of builder.rows[table] ?? []) row.forEach((value, column) => {
      const kind = metadataSchemas[table][column];
      const width = delta ? (kind === 'u16' ? 2 : 4) : metadataIndexWidth(kind, counts, flags);
      if (delta && (!Number.isInteger(value) || value < 0 || value > (width === 2 ? 0xffff : 0xffffffff))) {
        generationError('PDB_DELTA_INPUT', 'PDB delta table value exceeds its physical column width');
      }
      if (width === 2) tables.u16(value);
      else tables.u32(value);
    });
  }
  return tables.finish();
}

function identityStream(external, entryPoint) {
  const pdb = new Writer().zero(20).u32(entryPoint);
  let low = 0;
  let high = 0;
  for (const [table, count] of Object.entries(external)) {
    if (!count) continue;
    if (+table < 32) low |= 1 << +table;
    else high |= 1 << (+table - 32);
  }
  pdb.u32(low).u32(high);
  for (let table = 0; table < 64; table++) if (external[table]) pdb.u32(external[table]);
  return pdb.finish();
}

/** Serialize the common Portable PDB envelope; minimal deltas use wide references and the #JTD marker. */
export function finishPortablePdb(builder, external, entryPoint, delta = false) {
  const streams = [
    ['#Pdb', identityStream(external, entryPoint)],
    [delta ? '#-' : '#~', tableStream(builder, external, delta)],
    ['#Strings', builder.strings.finish()], ['#GUID', builder.guids.finish()], ['#Blob', builder.blobs.finish()],
  ];
  if (delta) streams.push(['#JTD', new Uint8Array()]);
  const root = new Writer().u32(0x424a5342).u16(1).u16(1).u32(0).u32(12)
    .bytes(utf8('PDB v1.0\0\0\0\0')).u16(0).u16(streams.length);
  const patches = [];
  for (const [name, bytes] of streams) {
    patches.push(root.length);
    root.u32(0).u32(bytes.length).bytes(utf8(name)).u8(0).pad();
  }
  let pdbOffset;
  streams.forEach(([name, bytes], index) => {
    root.pad();
    root.patch32(patches[index], root.length);
    if (name === '#Pdb') pdbOffset = root.length;
    root.bytes(bytes);
  });
  const bytes = root.finish();
  const checksum = sha256(bytes);
  const id = checksum.slice(0, 20);
  id[7] = (id[7] & 15) | 0x40;
  id[8] = (id[8] & 63) | 0x80;
  id[19] |= 0x80;
  bytes.set(id, pdbOffset);
  return { bytes, id, checksum };
}
