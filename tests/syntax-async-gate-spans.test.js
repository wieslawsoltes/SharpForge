import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SyntaxTree } from '@sharpforge/syntax';
import { assertGatesMatchRoslyn, diagnosticsOf, fixtureRoot } from './support/syntax-reference.js';

// SF-A01-T01.3: where the 'async function' feature is reported below C# 5. Roslyn reports an async method at its name,
// an async lambda or anonymous method at its `async` modifier, and every await expression at `await`. An async local
// function is reported only as a local function, at its name.
const relative = 'gates/async-functions.rejected.cs';

test('async functions at C# 4 are reported over the spans Roslyn reports', () => {
  const text = readFileSync(join(fixtureRoot, relative), 'utf8');
  const agreed = assertGatesMatchRoslyn(relative).filter(entry => entry.startsWith('CS8025@'));
  const words = agreed.map(entry => {
    const [start, end] = entry.split('@')[1].split('..').map(Number);
    return text.slice(start, end);
  });
  assert.deepEqual(
    words.join(' '),
    'M N await O Explicit async async async async await static async async static Local Other await await'
  );
});

test('an async method is reported at its name, also when the file has an await or an async lambda', () => {
  const inClass = members => `class C { ${members} }`;
  assert.deepEqual(diagnosticsOf(inClass('async void M() { }'), '4'), ['CS8025@21 "M"']);
  assert.deepEqual(diagnosticsOf(inClass('async void M() { await t; }'), '4'), ['CS8025@21 "M"', 'CS8025@27 "await"']);
  assert.deepEqual(diagnosticsOf(inClass('void M() { F(async () => 1); }'), '4'), ['CS8025@23 "async"']);
  assert.deepEqual(diagnosticsOf(inClass('void M() { F(async x => 1); }'), '4'), ['CS8025@23 "async"']);
  assert.deepEqual(diagnosticsOf(inClass('void M() { F(async delegate { }); }'), '4'), ['CS8025@23 "async"']);
});

test('nothing is reported from C# 5 on, and the feature is recorded once per function', () => {
  assert.deepEqual(diagnosticsOf('class C { async void M() { await t; F(async () => 1); } }', '5'), []);
  const uses = SyntaxTree.parseText('class C { async void M() { } void N() { F(async x => 1); } }').features.filter(use => use.id === 'Async');
  assert.equal(uses.length, 2);
});
