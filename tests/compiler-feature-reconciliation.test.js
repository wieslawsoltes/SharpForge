import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '@sharpforge/compiler';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';

test('semantic reconciliation preserves synthesized gates on reused trees', () => {
  const parsed = parse(new SourceText('int x = 1; struct S {}', 'Gate.cs'));
  const result = compile([{ ...parsed, features: [] }], { langVersion: '8' });
  assert.equal(result.success, false);
  assert.equal(result.semantic?.analysed, true);
  const gates = result.diagnostics.filter(d => d.code === 'CS8400');
  assert.equal(gates.length, 1);
  assert.match(gates[0].message, /top-level statements/i);
  assert.equal(gates[0].uri, 'Gate.cs');
});

test('syntax and semantic struct gates report each feature once at its modifier', () => {
  for (const modifier of ['readonly', 'ref', 'readonly ref']) {
    const source = `${modifier} struct S {}`;
    const result = compile(source, { langVersion: '7', outputKind: 'library' });
    const gates = result.diagnostics.filter(d => d.code === 'CS8107');
    assert.equal(gates.length, modifier.split(' ').length, JSON.stringify(result.diagnostics));
    assert.equal(new Set(gates.map(d => d.message)).size, gates.length);
    assert.deepEqual(gates.map(d => source.slice(d.start, d.start + d.length)), modifier.split(' '));
    assert.equal(compile(source, { langVersion: '7.2', outputKind: 'library' })
      .diagnostics.some(d => d.code === 'CS8107'), false);
  }
});

test('integrated feature diagnostics match captured Roslyn codes, messages and spans', () => {
  const reference = JSON.parse(readFileSync(new URL('../packages/compiler/test/feature-reconciliation/roslyn.json', import.meta.url)));
  assert.equal(reference.roslyn, '5.3.0-2.26153.122+4d3023de605a78ba3e59e50c657eed70f125c68a');
  assert.equal(reference.runtime, '10.0.5');
  const gates = diagnostics => diagnostics.filter(d => ['CS8107', 'CS8400', 'CS8023'].includes(d.code))
    .map(({ code, start, length, message, severity }) => ({ code, start, length, message, severity }));
  for (const row of reference.rows) {
    const actual = compile(row.source, { langVersion: row.langVersion, outputKind: row.outputKind });
    assert.deepEqual(gates(actual.diagnostics), gates(row.diagnostics), `${row.source} at C# ${row.langVersion}`);
  }
});

test('struct feature gates preserve separate declarations and per-file versions', () => {
  const files = [
    { uri: 'Old.cs', text: 'readonly partial struct S {} readonly struct T {}' },
    { uri: 'New.cs', text: 'readonly partial struct S {}' },
  ];
  const result = compile(files, { langVersion: '7.2', langVersionByUri: { 'Old.cs': '7' }, outputKind: 'library' });
  const gates = result.diagnostics.filter(d => d.code === 'CS8107');
  assert.equal(gates.length, 2, JSON.stringify(result.diagnostics));
  assert.deepEqual(gates.map(d => d.uri), ['Old.cs', 'Old.cs']);
  assert.equal(new Set(gates.map(d => d.start)).size, 2);
});

test('invalid language options are reported once while retaining profile rejection', () => {
  const result = compile('readonly struct S {}', { langVersion: 'invalid', outputKind: 'library' });
  assert.equal(result.success, false);
  assert.equal(result.image, null);
  assert.equal(result.diagnostics.filter(d => d.code === 'CS1617').length, 1);
  assert.equal(result.diagnostics.some(d => d.code === 'SF2201'), false);
});
