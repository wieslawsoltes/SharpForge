import { MetadataBuilder, Writer, readPE, writePE } from '@sharpforge/cil';

export const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Reuse the public metadata/PE writer; only unrelated data sections are mutated by the malformed corpus. */
export function boundsFixture(platform = 'anycpu') {
  const metadata = new MetadataBuilder('PEBoundsFixture').finish();
  const section = new Writer().zero(72).bytes(metadata).finish();
  const bytes = writePE(section, 72, metadata.length, 0, { platform, sections: [
    { name: '.one', data: Uint8Array.of(1, 2, 3, 4), characteristics: 0x40000040 },
    { name: '.two', data: Uint8Array.of(5, 6, 7, 8), characteristics: 0x40000040 },
  ] });
  return { bytes, pe: readPE(bytes), view: viewOf(bytes) };
}

export function sectionField(fixture, index, offset, value) {
  fixture.view.setUint32(fixture.pe.sections[index].headerOffset + offset, value, true);
}

const edits = {
  valid() {},
  'headers-exact'(f) { f.view.setUint32(f.pe.optionalStart + 60, f.pe.sections.at(-1).headerOffset + 40, true); },
  'header-at-64'(f) {
    f.bytes.copyWithin(64, f.pe.peHeaderOffset, f.pe.sections.at(-1).headerOffset + 40);
    f.view.setUint32(0x3c, 64, true);
  },
  'headers-file-end'(f) {
    f.view.setUint32(f.pe.optionalStart + 60, f.bytes.length, true);
  },
  'reordered-sections'(f) {
    const first = f.pe.sections[1].headerOffset, second = f.pe.sections[2].headerOffset;
    const saved = f.bytes.slice(first, first + 40);
    f.bytes.copyWithin(first, second, second + 40);
    f.bytes.set(saved, second);
  },
  bss(f) { sectionField(f, 2, 16, 0); sectionField(f, 2, 20, 0); },
  empty(f) {
    for (const offset of [8, 12, 16, 20]) sectionField(f, 2, offset, 0);
  },
  'empty-pointer-at-eof'(f) {
    sectionField(f, 2, 8, 0); sectionField(f, 2, 16, 0); sectionField(f, 2, 20, f.bytes.length);
  },
  'raw-padding'(f) { sectionField(f, 2, 8, 1); },
  'rva-exclusive-end'(f) { sectionField(f, 2, 12, 0x100000000 - f.pe.sections[2].size); },
  'touching-sections'(f) { sectionField(f, 2, 12, f.pe.sections[1].rva + f.pe.sections[1].size); },
  'pe-pointer-dos'(f) { f.view.setUint32(0x3c, 0x3c, true); },
  'pe-pointer-max'(f) { f.view.setUint32(0x3c, 0xffffffff, true); },
  'pe-pointer-truncated'(f) { f.view.setUint32(0x3c, f.bytes.length - 23, true); },
  'optional-truncated'(f) { f.view.setUint16(f.pe.peHeaderOffset + 20, 0xffff, true); },
  'section-table-truncated'(f) { f.view.setUint16(f.pe.peHeaderOffset + 6, 96, true); },
  'headers-too-small'(f) { f.view.setUint32(f.pe.optionalStart + 60, f.pe.sections.at(-1).headerOffset + 39, true); },
  'headers-max'(f) { f.view.setUint32(f.pe.optionalStart + 60, 0xffffffff, true); },
  'raw-start-max'(f) { sectionField(f, 2, 20, 0xffffffff); },
  'raw-size-max'(f) { sectionField(f, 2, 16, 0xffffffff); },
  'virtual-size-max'(f) { sectionField(f, 2, 8, 0xffffffff); },
  'rva-wrap'(f) { sectionField(f, 2, 12, 0xffffffff); },
  'raw-header-overlap'(f) { sectionField(f, 2, 20, f.pe.sizeOfHeaders - 1); },
  'virtual-header-overlap'(f) { sectionField(f, 2, 12, f.pe.sizeOfHeaders - 1); },
  'raw-overlap'(f) { sectionField(f, 2, 20, f.pe.sections[1].offset); },
  'virtual-overlap'(f) { sectionField(f, 2, 12, f.pe.sections[1].rva); },
  'bss-virtual-overlap'(f) {
    sectionField(f, 2, 16, 0); sectionField(f, 2, 20, 0); sectionField(f, 2, 12, f.pe.sections[1].rva);
  },
  'padding-virtual-overlap'(f) {
    sectionField(f, 2, 12, f.pe.sections[1].rva + f.pe.sections[1].virtualSize);
  },
  'empty-pointer-past-eof'(f) {
    sectionField(f, 2, 8, 0); sectionField(f, 2, 16, 0); sectionField(f, 2, 20, f.bytes.length + 1);
  },
};

export const acceptedCases = Object.freeze([
  'valid', 'headers-exact', 'header-at-64', 'reordered-sections', 'bss', 'empty', 'empty-pointer-at-eof',
  'raw-padding', 'rva-exclusive-end', 'touching-sections',
]);
export const caseIds = Object.freeze(Object.keys(edits));

export function boundsCase(id, platform = 'anycpu') {
  if (!Object.hasOwn(edits, id)) throw new Error('Unknown PE bounds fixture');
  const fixture = boundsFixture(platform);
  edits[id](fixture);
  return { ...fixture, id, accepted: acceptedCases.includes(id) };
}
