import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertGatesMatchRoslyn, diagnosticsOf, fixtureRoot } from './support/syntax-reference.js';

// Defect reported by the compiler workstream: an expression variable in the collection of the first `from` clause
// was gated below C# 7.3. Roslyn does not gate it: that collection (and the collection of a join) is evaluated where
// the query stands; only the other clause expressions become lambda bodies.
const relative = 'gates/query-first-from.rejected.cs';
const inMethod = body => `class C { void M() { ${body} } }`;

test('expression variables in queries are gated at C# 7.2 exactly where Roslyn gates them', () => {
  const text = readFileSync(join(fixtureRoot, relative), 'utf8');
  const named = assertGatesMatchRoslyn(relative).map(entry => {
    const [start, end] = entry.split('@')[1].split('..').map(Number);
    return text.slice(start, end);
  });
  assert.deepEqual(named, ['var inField', 'var inJoin', 'r', 't', 'v', 'm', 'ad', 'ae', 'ah', 'ak', 'aq', 'au']);
});

test('the first from collection and a join collection are not gated', () => {
  assert.deepEqual(diagnosticsOf(inMethod('var a = from x in F(out var n) select x + n;'), '7.2'), []);
  assert.deepEqual(diagnosticsOf(inMethod('var a = from x in o is int[] p ? p : null select x;'), '7.2'), []);
  assert.deepEqual(diagnosticsOf(inMethod('var a = from x in xs join y in F(out var h) on x equals y select x;'), '7.2'), []);
  assert.deepEqual(diagnosticsOf(inMethod('var a = from x in (from y in F(out var j) select y) select x;'), '7.2'), [], 'a nested first from');
  assert.deepEqual(diagnosticsOf(inMethod('var a = from x in F(out var n) select x + n;'), '7'), []);
});

test('every other clause is gated, over the variable name', () => {
  const gated = body => diagnosticsOf(inMethod(body), '7.2').map(entry => entry.split(' ').slice(1).join(' '));
  assert.deepEqual(gated('var a = from x in xs from y in F(out var r) select x;'), ['"r"']);
  assert.deepEqual(gated('var a = from x in xs where F(out var t) select x;'), ['"t"']);
  assert.deepEqual(gated('var a = from x in xs let z = F(out var v) select x;'), ['"v"']);
  assert.deepEqual(gated('var a = from x in xs join y in ys on F(out var d) equals F(out var e) select x;'), ['"d"', '"e"']);
  assert.deepEqual(gated('var a = from x in xs select (from y in F(out var m) select y);'), ['"m"'], 'a first from nested in a clause');
  assert.deepEqual(diagnosticsOf(inMethod('var a = from x in xs where F(out var t) select x;'), '7.3'), []);
});

test('in a field initializer the first from collection is gated as the initializer it is in', () => {
  assert.deepEqual(diagnosticsOf('class C { object f = from x in F(out var n) select x; }', '7.2'), ['CS8320@37 "var n"']);
  assert.deepEqual(diagnosticsOf('class C { object f = from x in F(out var n) select x; }', '7.3'), []);
});
