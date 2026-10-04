import test from 'node:test';
import assert from 'node:assert/strict';
import { CilError, readPE } from '@sharpforge/cil';
import { acceptedCases, boundsCase, caseIds } from './fixtures/pe-bounds/input.mjs';

for (const platform of ['anycpu', 'x64']) {
  for (const id of caseIds) {
    test(`PE bounds ${platform}: ${id}`, () => {
      const fixture = boundsCase(id, platform);
      if (fixture.accepted) {
        const pe = readPE(fixture.bytes);
        assert.equal(pe.imageKind, 'ILOnly');
        assert.deepEqual(pe.metadata.counts, fixture.pe.metadata.counts);
        assert.equal(pe.metadata.string(pe.metadata.rows[0][0][1]), 'PEBoundsFixture.dll');
      } else {
        assert.throws(() => readPE(fixture.bytes), error => {
          assert.ok(error instanceof CilError);
          assert.ok(Number.isInteger(error.offset) && error.offset >= 0 && error.offset < fixture.bytes.length);
          return true;
        });
      }
    });
  }
}

test('PE bounds sort private interval indexes and preserve public section order', () => {
  const fixture = boundsCase('reordered-sections');
  const pe = readPE(fixture.bytes);
  assert.deepEqual(pe.sections.map(section => section.name), ['.text', '.two', '.one']);
  for (const section of pe.sections) assert.equal(pe.offsetOf(section.rva), section.offset);
});

test('PE bounds preserve exact header and raw-file end equality', () => {
  const pe = readPE(boundsCase('headers-exact').bytes);
  assert.equal(pe.sizeOfHeaders, pe.sections.at(-1).headerOffset + 40);
  const last = pe.sections.at(-1);
  assert.equal(last.offset + last.size, pe.bytes.length);
  assert.equal(pe.offsetOf(last.rva + last.size, 0), pe.bytes.length);
  assert.throws(() => pe.offsetOf(last.rva + last.size, 1), CilError);
});

test('PE bounds admit the exact 2^32 exclusive RVA end without wrapping', () => {
  const pe = readPE(boundsCase('rva-exclusive-end').bytes);
  const section = pe.sections.at(-1);
  assert.equal(pe.offsetOf(0xffffffff, 1), section.offset + section.size - 1);
  assert.equal(pe.offsetOf(0x100000000, 0), section.offset + section.size);
  assert.throws(() => pe.offsetOf(0xffffffff, 2), CilError);
  assert.throws(() => pe.offsetOf(0x100000000, 1), CilError);
});

test('PE bounds do not produce file addresses from BSS or empty raw sections', () => {
  for (const id of ['bss', 'empty', 'empty-pointer-at-eof']) {
    const pe = readPE(boundsCase(id).bytes);
    const section = pe.sections.at(-1);
    assert.equal(section.size, 0);
    for (const length of [0, 1]) assert.throws(() => pe.offsetOf(section.rva, length), CilError);
  }
});

test('PE bounds preserve nonempty endpoint ambiguity and raw padding addressability', () => {
  const touching = readPE(boundsCase('touching-sections').bytes);
  assert.equal(touching.offsetOf(touching.sections[2].rva, 1), touching.sections[2].offset);
  assert.throws(() => touching.offsetOf(touching.sections[2].rva, 0), /ambiguous RVA/);
  const padded = readPE(boundsCase('raw-padding').bytes);
  const section = padded.sections.at(-1);
  assert.ok(section.size > section.virtualSize);
  assert.equal(padded.offsetOf(section.rva + section.size - 1, 1), section.offset + section.size - 1);
});

test('PE RVA queries reject invalid arithmetic operands with CilError', () => {
  const pe = readPE(boundsCase('valid').bytes);
  for (const value of [null, undefined, '1', {}, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => pe.offsetOf(value, 1), CilError);
    if (value !== undefined) assert.throws(() => pe.offsetOf(0x2000, value), CilError);
  }
  assert.equal(acceptedCases.length, 10);
});
