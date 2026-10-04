import { MetadataBuilder, Writer, writePE } from '@sharpforge/cil';

export function fixture(count = 4, pointerOrder = null) {
  const metadata = new MetadataBuilder('Navigation', { uncompressed: !!pointerOrder });
  metadata.rows[0][0][2] = metadata.guid(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
  const userString = metadata.userString('Navigation value');
  metadata.add(2, [1, metadata.string('Fixture'), 0, 0, 1, 1]);
  const signature = metadata.blob(new Uint8Array([0, 0, 1]));
  for (let index = 0; index < count; index++)
    metadata.add(6, [0x2048, 0, 0x16, metadata.string('M' + index), signature, 1]);
  for (const row of pointerOrder ?? []) metadata.add(5, [row]);
  const bytes = metadata.finish();
  const section = new Writer().zero(72).u8(6).u8(0x2a).pad();
  const offset = section.length;
  section.bytes(bytes);
  return { bytes: writePE(section.finish(), offset, bytes.length, 0), userString: 0x70000000 + userString };
}
