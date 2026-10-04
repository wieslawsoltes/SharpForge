import { MetadataBuilder, Writer, writePE } from '@sharpforge/cil';

export function assemblyFixture(module = 1, methods = 10, pointerOrder = null) {
  const metadata = new MetadataBuilder('Indexed' + module, { uncompressed: !!pointerOrder });
  metadata.rows[0][0][2] = metadata.guid(Uint8Array.from({ length: 16 }, (_, index) => index === 15 ? module : index + 1));
  metadata.add(2, [0, metadata.string('<Module>'), 0, 0, 1, 1]);
  metadata.add(2, [1, metadata.string('Fixture'), metadata.string('Index'), 0, 1, 1]);
  metadata.add(4, [6, metadata.string('Value'), metadata.blob(new Uint8Array([6, 8]))]);
  const signature = metadata.blob(new Uint8Array([0, 0, 1]));
  for (let index = 0; index < methods; index++)
    metadata.add(6, [0x2048, 0, 0x16, metadata.string('M' + index), signature, 1]);
  for (const row of pointerOrder ?? []) metadata.add(5, [row]);
  metadata.add(21, [2, 1]);
  metadata.add(23, [0, metadata.string('Item'), metadata.blob(new Uint8Array([8, 0, 8]))]);
  metadata.add(18, [2, 1]);
  metadata.add(20, [0, metadata.string('Changed'), 8]);
  metadata.add(2, [2, metadata.string('Inner'), 0, 0, 2, methods + 1]);
  metadata.add(41, [3, 2]);
  const bytes = metadata.finish();
  const section = new Writer().zero(72).u8(6).u8(0x2a).pad();
  const offset = section.length;
  section.bytes(bytes);
  return writePE(section.finish(), offset, bytes.length, 0);
}
