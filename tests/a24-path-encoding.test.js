import test from 'node:test';
import assert from 'node:assert/strict';
import {PathPolicy, portablePath, decodeWorkspaceFile, encodeWorkspaceFile} from '@sharpforge/archive';

test('A24 path identity separates portable spelling from case and Unicode policy', () => {
  const sensitive = new PathPolicy();
  const insensitive = new PathPolicy({caseSensitive: false});
  assert.equal(insensitive.equals('Src/Program.CS', 'src/program.cs'), true);
  assert.equal(sensitive.equals('Program.CS', 'program.cs'), false);
  assert.equal(sensitive.equals('é.cs', 'e\u0301.cs'), true);
  assert.equal(new PathPolicy({unicodeNormalization: 'none'}).equals('é.cs', 'e\u0301.cs'), false);
  assert.equal(insensitive.normalize('e\u0301.cs'), 'e\u0301.cs');
  assert.equal(insensitive.contains('Src', 'src/Program.cs'), true);
  assert.equal(insensitive.contains('Src', 'src2/Program.cs'), false);
  assert.equal(insensitive.identity('', {allowRoot: true}), '');
});

test('A24 portable paths reject traversal, controls, reserved components and bounded names', () => {
  for (const value of ['../x', '/x', 'C:\\x', 'con.txt', 'a/aux.cs', 'a.', 'a ', 'x\u0000', 'a//b', 'a:stream']) {
    assert.throws(() => portablePath(value), undefined, value);
  }
  assert.equal(portablePath('a\\b.cs'), 'a/b.cs');
  assert.equal(portablePath('abc', {maxPathLength: 3}), 'abc');
  assert.throws(() => portablePath('abcd', {maxPathLength: 3}));
  assert.throws(() => portablePath('a/b/c', {maxDepth: 2}));
  assert.throws(() => new PathPolicy({unicodeNormalization: 'invalid'}));
});

for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
  for (const bom of [false, true]) {
    test(`A24 encoding retains ${encoding}, BOM=${bom} and mixed per-line delimiters`, () => {
      const original = 'line one\r\nline two\nline three\rline four';
      const bytes = encodeWorkspaceFile({text: original, encoding, bom});
      const record = decodeWorkspaceFile('a.cs', bytes);
      assert.equal(record.text, original);
      assert.equal(record.encoding, encoding);
      assert.equal(record.bom, bom);
      assert.equal(record.lineEnding, 'mixed');
      assert.equal(record.finalNewline, false);
      assert.deepEqual(encodeWorkspaceFile(record), bytes);
      const edited = {...record, text: 'changed\nline two\nline three\nline four'};
      assert.equal(decodeWorkspaceFile('a.cs', encodeWorkspaceFile(edited)).text, 'changed\r\nline two\nline three\rline four');
    });
  }
}

test('A24 Windows-1252 fallback is flagged and unchanged bytes survive exactly', () => {
  const bytes = Uint8Array.of(0x93, 0x80, 0xe9, 0x94, 13, 10);
  const record = decodeWorkspaceFile('legacy.txt', bytes);
  assert.equal(record.encoding, 'windows-1252');
  assert.equal(record.lossy, true);
  assert.equal(record.text, '“€é”\r\n');
  assert.equal(record.finalNewline, true);
  assert.deepEqual(encodeWorkspaceFile(record), bytes);
  assert.deepEqual(encodeWorkspaceFile({...record, text: '€!\n'}), Uint8Array.of(128, 33, 13, 10));
  assert.throws(() => encodeWorkspaceFile({...record, text: '😀'}), error => error.code === 'SFWENC002');
  assert.equal(decodeWorkspaceFile('legacy.txt', bytes, {legacyFallback: false}).text, undefined);
});

test('A24 binary and malformed UTF-16 inputs retain bytes without fabricated text', () => {
  for (const bytes of [Uint8Array.of(0), Uint8Array.of(255, 254, 0), Uint8Array.of(255, 254, 0, 0)]) {
    const record = decodeWorkspaceFile('a.cs', bytes);
    assert.equal(record.text, undefined);
    assert.deepEqual(encodeWorkspaceFile(record), bytes);
  }
  assert.equal(decodeWorkspaceFile('opaque.bin', new TextEncoder().encode('text')).text, undefined);
  assert.equal(decodeWorkspaceFile('empty.txt', new Uint8Array()).text, '');
  assert.throws(() => encodeWorkspaceFile({text: '\ud800'}), error => error.code === 'SFWENC003');
});
