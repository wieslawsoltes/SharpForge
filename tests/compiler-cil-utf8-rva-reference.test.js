import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { compileToAssembly, compileToReferenceAssembly, createReferenceSet } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { literalInstructions, referenceWithoutSpanConstructor, utf8DataRows } from './fixtures/utf8-rva/metadata.mjs';

const pack = loadReferencePack();
const options = { name: 'Utf8Literals', outputKind: 'library', langVersion: '11' };
const source = readFileSync(new URL('./fixtures/utf8-rva/Utf8Literals.cs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const errors = result => result.diagnostics.filter(item => item.severity === 'error');
const settings = { skip: pack ? false : 'no .NET reference pack installed' };

function projectedReferences(kind) {
  return createReferenceSet(pack.pack.files.map(path => ({ display: path, bytes: basename(path) === 'System.Runtime.dll'
    ? referenceWithoutSpanConstructor(readFileSync(path), kind).bytes : readFileSync(path) })));
}

test('A02-T77 actual references select RVA lowering and preserve Roslyn UTF-8 bytes', settings, () => {
  const result = compileToAssembly(source, { ...options, references: pack.references });
  assert.deepEqual(errors(result), []);
  const expected = readFileSync(new URL('./fixtures/utf8-rva/Utf8Literals.dll', import.meta.url));
  const payloads = bytes => utf8DataRows(bytes).map(row => Buffer.from(row.bytes).toString('hex')).sort();
  assert.deepEqual(payloads(result.assembly), payloads(expected));
  assert.ok(!literalInstructions(result.assembly, 'Ascii').some(item => item.name === 'newarr'));
});

test('A02-T77 a missing optional pointer constructor uses the real array/start/length fallback', settings, () => {
  const references = projectedReferences('pointer');
  const result = compileToAssembly(source, { ...options, references });
  assert.deepEqual(errors(result), []);
  assert.deepEqual(utf8DataRows(result.assembly), []);
  const instructions = literalInstructions(result.assembly, 'Ascii');
  assert.equal(instructions.filter(item => item.name === 'newarr').length, 1);
  assert.ok(instructions.some(item => item.name === 'newobj'));
  assert.ok(!instructions.some(item => item.name === 'ldsflda'));
  const reference = compileToReferenceAssembly(source, { ...options, references });
  assert.deepEqual(errors(reference), []);
  assert.deepEqual(utf8DataRows(reference.assembly), []);
});

test('A02-T77 a missing required array constructor reports Roslyn CS0656 even when pointer ctor exists', settings, () => {
  const references = projectedReferences('array');
  const probe = 'using System; public class C { public static ReadOnlySpan<byte> Text() => "x"u8; }';
  const result = compileToAssembly({ uri: 'Missing.cs', text: probe }, { ...options, references });
  const expected = JSON.parse(readFileSync(new URL('./fixtures/utf8-rva/missing-constructor.json', import.meta.url), 'utf8'));
  assert.equal(result.assembly, null);
  assert.deepEqual(errors(result).map(item => [item.code, item.message]), expected);
  assert.equal(probe.slice(errors(result)[0].start, errors(result)[0].start + errors(result)[0].length), '"x"u8');
  const reference = compileToReferenceAssembly(probe, { ...options, references });
  assert.deepEqual(errors(reference), []);
  assert.deepEqual(utf8DataRows(reference.assembly), []);
});
