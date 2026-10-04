import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyInspector, assembleILDocument, formatILDocument, readPE, CilError, loadAssembly } from '@sharpforge/cil';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { compileToIL } from '@sharpforge/compiler';
import { managedFixture } from './managed-fixtures.js';
import { withMetadataStreams } from './support/il-document-metadata.js';
import { literal, stringFixture, literalDocument, rebuiltStringFixture } from './fixtures/a03-il-document-strings/input.js';

const run = (bytes, methodToken = 'Main') => {
  const result = new CilVirtualMachine(bytes, { methodToken }).run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  return result;
};
const stringToken = (inspector, token) => inspector.getMethod(token).instructions.find(instruction => instruction.name === 'ldstr').operand;

test('new ldstr literal and long loop assemble through shared layout and match native execution', () => {
  assert.throws(() => assembleILDocument(literalDocument()), /Short branch out of range/);
  const bytes = rebuiltStringFixture();
  assert.equal(run(bytes).returnValue, literal);
  assert.equal(run(bytes, 'Original').returnValue, 'old');
  assert.equal(run(bytes, 'Again').returnValue, literal);
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-il-document-strings/native.json', import.meta.url), 'utf8'));
  assert.equal(capture.runtime, '.NET 10.0.5');
  assert.deepEqual(capture.results, { Main: literal, Original: 'old', Again: literal });
  const instructions = new AssemblyInspector(bytes).getMethod(0x06000001).instructions;
  assert(instructions.some(instruction => instruction.name === 'br'));
  assert(instructions.some(instruction => instruction.name === 'blt'));
});

test('append-only heap preserves old tokens, deduplicates additions and keeps existing metadata rows', () => {
  const original = stringFixture(), before = new AssemblyInspector(original);
  const bytes = rebuiltStringFixture(), after = new AssemblyInspector(bytes);
  const oldToken = stringToken(before, 0x06000002), newToken = stringToken(after, 0x06000001);
  assert.equal(stringToken(after, 0x06000002), oldToken);
  assert.equal(stringToken(after, 0x06000003), newToken);
  assert(newToken > oldToken);
  const previousHeap = before.metadata.streams.get('#US'), nextHeap = after.metadata.streams.get('#US');
  assert.deepEqual(nextHeap.subarray(0, previousHeap.length), previousHeap);
  for (const name of ['#Strings', '#Blob', '#GUID']) assert.deepEqual(after.metadata.streams.get(name), before.metadata.streams.get(name));
  for (const [table, rows] of Object.entries(before.metadata.rows)) {
    const comparable = values => Number(table) === 6 ? values.map(row => row.slice(1)) : values;
    assert.deepEqual(comparable(after.metadata.rows[table]), comparable(rows));
  }
  assert.deepEqual(readPE(bytes).metadata.guid(1), before.metadata.guid(1));
});

test('JSON literal escaping preserves UTF-16 including comments, controls and lone surrogates', () => {
  for (const value of ['', 'https://host/a//b', 'quote"\\tail', '\0\n\t', '\u0001\u000e\u007f', 'λ🚀', '\ud800', '\udfff']) {
    const bytes = assembleILDocument(literalDocument(stringFixture(), value, false)).bytes;
    const inspector = new AssemblyInspector(bytes);
    assert.equal(inspector.metadata.userString(stringToken(inspector, 0x06000001)), value);
    assert.equal(run(bytes).returnValue, value);
  }
  const text = literalDocument(stringFixture(), 'A', false).replace('ldstr "A"', 'ldstr "\\u0041"');
  assert.equal(run(assembleILDocument(text).bytes).returnValue, 'A');
});

test('numeric-token documents keep the previous metadata root and need no #US growth budget', () => {
  const source = stringFixture(), text = formatILDocument(source);
  const normal = assembleILDocument(text).bytes, disabled = assembleILDocument(text, { maxUserStringBytes: 0 }).bytes;
  assert.deepEqual(normal, disabled);
  assert.equal(readPE(normal).metadataDirectory.rva, readPE(source).metadataDirectory.rva);
  assert.deepEqual(readPE(normal).metadata.streams.get('#US'), readPE(source).metadata.streams.get('#US'));
});

test('missing #US, unknown streams and uncompressed table streams survive literal insertion', () => {
  const source = managedFixture({ name: 'MissingUserHeap', entry: null,
    methods: [{ name: 'Main', result: 'string', body: writer => writer.op('ldnull').op('ret') }],
    decorate: context => { context.md.uncompressed = true; },
  });
  const bytes = withMetadataStreams(source, streams => { streams.delete('#US'); streams.set('#Vendor', Uint8Array.of(9, 8, 7)); });
  const text = formatILDocument(bytes).replace('ldnull', 'ldstr "added"');
  const rebuilt = assembleILDocument(text).bytes, metadata = readPE(rebuilt).metadata;
  assert.equal(run(rebuilt).returnValue, 'added');
  assert(metadata.streams.has('#-'));
  assert.deepEqual(metadata.streams.get('#Vendor'), Uint8Array.of(9, 8, 7));
  const full = withMetadataStreams(bytes, streams => {
    while (streams.size < 32) streams.set('#X' + streams.size, new Uint8Array());
  });
  assert.throws(() => assembleILDocument(formatILDocument(full).replace('ldnull', 'ldstr "x"')), /Too many metadata streams/);
});

test('heap preflight rejects oversized additions and malformed JSON with CilError', () => {
  const source = stringFixture(), text = literalDocument(source, 'abcd', false);
  const required = readPE(source).metadata.streams.get('#US').length + 10;
  assert.equal(run(assembleILDocument(text, { maxUserStringBytes: required }).bytes).returnValue, 'abcd');
  assert.throws(() => assembleILDocument(text, { maxUserStringBytes: required - 1 }), /heap limit exceeded/);
  for (const limit of [-1, NaN, 0x1000001, '32']) {
    assert.throws(() => assembleILDocument(text, { maxUserStringBytes: limit }), /Invalid IL user-string heap limit/);
  }
  for (const value of ['x'.repeat(1000), '\0'.repeat(1000)]) {
    assert.throws(() => assembleILDocument(literalDocument(source, value, false), { maxUserStringBytes: 32 }), /heap limit exceeded/);
  }
  for (const operand of ['"unterminated', '"bad\\q"', '"ok" junk']) {
    const malformed = literalDocument(source, 'valid', false).replace('"valid" // new literal', operand);
    assert.throws(() => assembleILDocument(malformed), error => error instanceof CilError && /literal/.test(error.message));
  }
});

test('literal edits invalidate the original #SF profile and run through ordinary CIL', () => {
  const compiled = compileToIL('Console.WriteLine("old");');
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const text = formatILDocument(compiled.assembly).replace(/ldstr 0x[\da-f]+[^\n]*/, 'ldstr "new // text"');
  const bytes = assembleILDocument(text).bytes;
  const result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, 'new // text\n');
  assert.equal(readPE(bytes).metadata.streams.has('#SF'), false);
  assert.throws(() => loadAssembly(bytes), /arbitrary .NET assembly/);
});
