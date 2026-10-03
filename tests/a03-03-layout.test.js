import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Writer, MetadataBuilder, writePE, writePortableExecutable, readPE } from '@sharpforge/cil';

function section() {
  const metadata = new MetadataBuilder('Layout').finish();
  return { data: new Writer().zero(72).bytes(metadata).finish(), metadata };
}

test('A03 default PE32 writer preserves the pinned legacy bytes', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/a03-pe/legacy-pe32.json', import.meta.url), 'utf8'));
  const bytes = writePE(Uint8Array.from(fixture.section), fixture.metadataOffset, fixture.metadataLength, fixture.entryToken);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256);
});

test('A03 ordered sections use computed directory RVAs and requested alignment', () => {
  const { data, metadata } = section();
  const bytes = writePE(data, 72, metadata.length, 0, { fileAlignment: 1024, sectionAlignment: 4096,
    sections: [{ name: '.reloc', data: new Uint8Array(12) }, { name: '.rsrc', data: new Uint8Array(24) }] });
  const pe = readPE(bytes);
  assert.deepEqual(pe.sections.map(item => item.name), ['.text', '.rsrc', '.reloc']);
  assert(pe.sections.every(item => item.offset % 1024 === 0 && item.rva % 4096 === 0));
  assert.equal(pe.fileAlignment, 1024);
  assert.equal(pe.sectionAlignment, 4096);
  assert.deepEqual(pe.directories.resource, { name: 'resource', rva: pe.sections[1].rva, size: 24 });
  assert.deepEqual(pe.directories.baseRelocation, { name: 'baseRelocation', rva: pe.sections[2].rva, size: 12 });
  assert.equal(pe.sizeOfImage, pe.sections[2].rva + 4096);
});

test('A03 PE layout rejects invalid sections, directories and alignment combinations', () => {
  const { data, metadata } = section();
  for (const options of [{ fileAlignment: 513 }, { sectionAlignment: 256 }, { imageBase: 3n },
    { platform: 'unknown' }, { firstSectionRva: 1 }, { prefer32Bit: 'false' }, { imageBase: Number.MAX_VALUE }, { timestamp: -1 }, { imageBase: 0xffff0000, sectionAlignment: 0x10000 }]) {
    assert.throws(() => writePE(data, 72, metadata.length, 0, options));
  }
  assert.throws(() => writePortableExecutable([]), /section count/);
  assert.throws(() => writePortableExecutable([{ name: 'too-long-name', data }]), /section name/);
  assert.throws(() => writePE(data, 72, metadata.length, 0, { sections: [{ name: '.text', data }] }), /duplicate/);
  assert.throws(() => writePE(data, 72, metadata.length, 0,
    { directories: { resource: { section: '.missing', offset: 0, size: 1 } } }), /directory exceeds/);
  assert.throws(() => writePE(data, 71, metadata.length, 0), /metadata range/);
  assert.throws(() => writePE(data, 72, metadata.length + 1, 0), /metadata range/);
});

test('A03 writer rejects missing sections and non-token entry points explicitly', () => {
  const { data, metadata } = section();
  assert.throws(() => writePortableExecutable(null), /section count/);
  const sections = [{ name: '.text', data }, { name: '.rsrc', data }, { name: '.reloc', data }, { name: '.extra', data }];
  assert.throws(() => writePortableExecutable(sections,
    { fileAlignment: 512, sectionAlignment: 512, firstSectionRva: 512 }), /overlap image headers/);
  for (const value of [-1, 0.5, 0x100000000, undefined]) assert.throws(() => writePE(data, 72, metadata.length, value), /entry point/);
});
