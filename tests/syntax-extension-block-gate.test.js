import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertGatesMatchRoslyn, diagnosticsOf, fixtureRoot } from './support/syntax-reference.js';

// Reported by the compiler workstream: an `extension(...)` block below C# 14 must report CS9260 with Roslyn's span.
// Below C# 14 Roslyn's parser reads `extension(T x) { }` as a constructor (only `extension<` starts a block) and
// reports the whole declaration; for `extension<T>(...)` it reports the keyword.
const relative = 'gates/csharp14-extension-blocks.rejected.cs';

test('extension blocks at C# 13 report CS9260 over the spans Roslyn reports', () => {
  const text = readFileSync(join(fixtureRoot, relative), 'utf8');
  const spans = assertGatesMatchRoslyn(relative).map(entry => {
    const [start, end] = entry.split('@')[1].split('..').map(Number);
    return text.slice(start, end).split('\n')[0];
  });
  assert.deepEqual(spans, [
    'extension(int x) { }',
    'public extension(int y) { }',
    'extension(int z);',
    'extension(int w) => 1;',
    '[System.Obsolete] extension(string s) { }',
    'extension',
    'extension',
    'extension(int open)'
  ]);
});

test('the constructor-shaped form is reported once, over the declaration, and not as a method without a return type', () => {
  assert.deepEqual(diagnosticsOf('static class E { extension(int x) { } }', '13'), ['CS9260@17 "extension(int x) { }"']);
  assert.deepEqual(diagnosticsOf('static class E { public extension(int x) => F(); }', '13'), ['CS9260@17 "public extension(int x) => F();"']);
  assert.deepEqual(diagnosticsOf('static class E { extension<T>(T x) { } }', '13'), ['CS9260@17 "extension"']);
});

test('C# 14 accepts the block; a type named extension keeps its constructors at every version', () => {
  assert.deepEqual(diagnosticsOf('static class E { extension(int x) { } }', '14'), []);
  assert.deepEqual(diagnosticsOf('class extension { extension(int x) { } public extension() { } }', '13'), []);
  assert.deepEqual(diagnosticsOf('class C { @extension(int x) { } }', '13'), ['CS1520@10 "@extension"']);
  assert.deepEqual(diagnosticsOf('class C { D(int x) { } }', '13'), ['CS1520@10 "D"']);
});
