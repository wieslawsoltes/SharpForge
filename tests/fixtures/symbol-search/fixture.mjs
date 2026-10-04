import { MetadataBuilder, Writer, writePE } from '@sharpforge/cil';

export function typeFixture(names = 50000) {
  const metadata = new MetadataBuilder('SymbolSearch');
  metadata.rows[0][0][2] = metadata.guid(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
  metadata.add(2, [0, metadata.string('<Module>'), 0, 0, 1, 1]);
  const count = Array.isArray(names) ? names.length : names;
  for (let index = 0; index < count; index++) {
    const name = Array.isArray(names) ? names[index] : 'SearchType' + String(index).padStart(5, '0');
    metadata.add(2, [1, metadata.string(name), metadata.string('Fixtures'), 0, 1, 1]);
  }
  const bytes = metadata.finish();
  const section = new Writer().zero(72).bytes(bytes).finish();
  return writePE(section, 72, bytes.length, 0);
}
