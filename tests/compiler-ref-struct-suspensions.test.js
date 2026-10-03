import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// SF-A02-T82: ref struct locals and unsafe code in async methods and iterators (C# 13). The Roslyn-pinned programs
// are the `ref-locals-in-iterators-async` fixtures of packages/compiler/test/differential (Roslyn 5.3.0-2.26153.122);
// these tests look at single rules and at the boundaries the fixtures do not isolate.

const prelude = 'using System.Collections.Generic; using System.Threading.Tasks; ref struct R { public int V; public int W; } ';
const found = (members, options = {}) => {
  const source = `${prelude}class Program { ${members} static void Main() { } }`,
    file = parse(new SourceText(source, 'Program.cs'), undefined, options.langVersion ? { languageVersion: options.langVersion } : {});
  return analyze([file], options)
    .diagnostics.filter(d => d.severity === 'error')
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
};

test('A02-T82 CS4007: a ref struct local read after an await or a yield return', () => {
  assert.deepEqual(found('static async Task<int> M() { R r = new R(); await Task.Delay(1); return r.V; }'), ['CS4007:r.V']);
  assert.deepEqual(found('static IEnumerable<int> M() { R r = new R(); yield return 1; yield return r.V; }'), ['CS4007:r.V']);
  // The whole value: reported on the local.
  assert.deepEqual(found('static int U(R r) { return 0; } static async Task<int> M() { R r = new R(); await Task.Delay(1); return U(r); }'), ['CS4007:r']);
});

test('A02-T82 no CS4007 when the value is written after the suspension, or not read after it', () => {
  assert.deepEqual(found('static async Task<int> M() { R r = new R(); int v = r.V; await Task.Delay(1); return v; }'), []);
  assert.deepEqual(found('static async Task<int> M() { R r = new R(); await Task.Delay(1); r = new R(); return r.V; }'), []);
  assert.deepEqual(found('static async Task<int> M() { R r = new R(); await Task.Delay(1); r.V = 1; return r.V; }'), []);
  assert.deepEqual(found('static IEnumerable<int> M() { { R r = new R(); r.V = 2; } yield return 1; }'), []);
});

test('A02-T82 a write covers a read only for its own field and only when it is not conditional', () => {
  // The conditional write is pinned (fixture method `Branch`); the other-field case follows the same rule and is not.
  assert.deepEqual(found('static async Task<int> M() { R r = new R(); await Task.Delay(1); r.V = 1; return r.W; }'), ['CS4007:r.W']);
  assert.deepEqual(found('static async Task<int> M(bool b) { R r = new R(); await Task.Delay(1); if (b) r.V = 1; return r.V; }'), ['CS4007:r.V']);
});

test('A02-T82 a loop carries the suspension back to a read at its top', () => {
  assert.deepEqual(found('static async Task<int> M() { R r = new R(); for (int i = 0; i < 2; i++) { r.V++; await Task.Delay(1); } return 0; }'), ['CS4007:r.V']);
  assert.deepEqual(found('static async Task<int> M() { for (int i = 0; i < 2; i++) { R r = new R(); r.V++; await Task.Delay(1); } return 0; }'), []);
});

test('A02-T82 CS4007 is found only in a program without other errors (Roslyn finds it while lowering)', () => {
  const members = 'static async Task<int> M() { R r = new R(); await Task.Delay(1); return r.V + missing; }';
  assert.deepEqual(found(members), ['CS0103:missing']);
});

test('A02-T82 below C# 13 a ref struct local of an async method is the gated feature; an iterator local is not', () => {
  assert.deepEqual(found('static async Task<int> M() { R r = new R(); return r.V; }', { langVersion: '12' }), ['CS9202:R']);
  assert.deepEqual(found('static IEnumerable<int> M() { R r = new R(); yield return r.V; }', { langVersion: '12' }), []);
  // Parameters stay errors at every version.
  assert.deepEqual(found('static async Task<int> M(R r) { return 0; }').map(row => row.split(':')[0]), ['CS4012']);
});

test('A02-T82 unsafe code in iterators: CS9238 for yield return in an unsafe block, CS9239 for & of a local', () => {
  const unsafe = { allowUnsafe: true };
  assert.deepEqual(found('static IEnumerable<int> M() { unsafe { yield return 1; } }', unsafe), ['CS9238:yield']);
  assert.deepEqual(found('static IEnumerable<int> M() { unsafe { yield break; } }', unsafe), []);
  assert.deepEqual(found('static IEnumerable<int> M() { unsafe { int x = 1; int* p = &x; } yield return 1; }', unsafe), ['CS9239:x']);
  // Not an iterator: `&x` is fine.
  assert.deepEqual(found('static int M() { unsafe { int x = 1; int* p = &x; return *p; } }', unsafe), []);
});
