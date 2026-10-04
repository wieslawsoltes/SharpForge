import { Writer, codedIndex, token, utf8 } from '@sharpforge/cil';
import { PdbGuids, PortablePdbBuilder, deflateStored, readPortablePdb, sha256, writeSequencePoints } from '@sharpforge/symbols';

/** Tiny authored symbols containing one document, local, sequence point and optional compressed source. */
export function createAuthoredPortablePdbSeed(compressed) {
  if (typeof compressed !== 'boolean') throw new TypeError('Compressed-source selection must be boolean');
  const builder = new PortablePdbBuilder();
  const source = utf8('int value = 7;\n');
  const name = new Writer().u8(0).compressed(builder.blob(utf8('Fuzz.cs'))).finish();
  const document = builder.add(48, [
    builder.blob(name), builder.guid(PdbGuids.sha256), builder.blob(sha256(source)), builder.guid(PdbGuids.csharp),
  ]);
  const points = writeSequencePoints([
    { document, offset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 15 },
  ], document);
  builder.add(49, [document, builder.blob(points)]);
  builder.add(51, [0, 0, builder.string('value')]);
  builder.add(50, [1, 0, 1, 1, 0, 2]);
  const content = compressed ? deflateStored(source) : source;
  const embedded = new Writer().u32(compressed ? source.length : 0).bytes(content).finish();
  builder.add(55, [
    codedIndex('HasCustomDebugInformation', token(48, document)),
    builder.guid(PdbGuids.embeddedSource), builder.blob(embedded),
  ]);
  return { name: compressed ? 'compressed-source' : 'stored-source', input: builder.finish({ 6: 1 }, 0).bytes };
}

/** Fixed malformed copies stay under 1 KiB; no payload amplification or arbitrary input is accepted. */
export function createPortablePdbBoundarySeeds() {
  const original = createAuthoredPortablePdbSeed(true).input;
  if (original.length > 1024) throw new Error('Authored Portable PDB byte bound changed');
  const metadata = readPortablePdb(original, {
    maxBytes: 1024, maxSourceBytes: 64,
    budgets: { documents: 1, methods: 1, scopes: 1, imports: 1, customRecords: 1, cdiBytes: 64, embeddedSourceBytes: 64 },
  }).metadata;
  const documentOffset = metadata.tableOffset + metadata.rowOffsets[49][0];
  const embedded = metadata.blob(metadata.rows[55][0][2]);
  const embeddedOffset = embedded.byteOffset - original.byteOffset;
  if (metadata.counts[48] !== 1 || embedded.length < 5) {
    throw new Error('Authored Portable PDB boundary fixture invariant changed');
  }
  const row = original.slice();
  new DataView(row.buffer, row.byteOffset, row.byteLength).setUint16(documentOffset, 2, true);
  const size = original.slice();
  new DataView(size.buffer, size.byteOffset, size.byteLength).setInt32(embeddedOffset, -1, true);
  const block = original.slice();
  block[embeddedOffset + 4] = 7;
  return [
    { name: 'invalid-document-index', input: row },
    { name: 'invalid-compression-size', input: size },
    { name: 'invalid-compression-block', input: block },
  ];
}
