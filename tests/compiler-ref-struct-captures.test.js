import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

const types = 'using System;\nref struct RS { public int X; }\nstruct Plain { public int X; }\n';
/** The errors of a method body over `RS p`, as `code@text`. */
function errors(body, members = '') {
  const source = `${types}static class P {\n${members}  static void M(RS p) {\n${body}\n  }\n  static void Main() { }\n}\n`;
  return compile(source)
    .diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code))
    .map(d => `${d.code}@${source.slice(d.start, d.start + d.length)}`);
}

test('SF-A02-T04.5 corpus: ref struct capture, field and array fixtures match Roslyn', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.feature === 'ref-struct-captures');
  assert.equal(fixtures.length, 3);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T04.5 a ref struct local or parameter cannot be captured', () => {
  assert.deepEqual(errors('RS r = new RS(); Func<int> f = () => r.X;'), ['CS8175@r']);
  assert.deepEqual(errors('RS r = new RS(); Action a = delegate { r.X = 1; };'), ['CS8175@r']);
  assert.deepEqual(errors('RS r = new RS(); int L() => r.X; L();'), ['CS8175@r']);
  assert.deepEqual(errors('Func<int> f = () => p.X;'), ['CS9108@p']);
  assert.deepEqual(errors('Span<int> s = stackalloc int[2]; Func<int> f = () => s.Length;'), ['CS8175@s']);
  assert.deepEqual(errors('RS r = new RS(); Func<int> f = () => { Func<int> g = () => r.X; return g(); };'), ['CS8175@r'], 'reported once');
});

test('SF-A02-T04.5 what is not a capture', () => {
  assert.deepEqual(errors('Plain v = new Plain(); Func<int> f = () => v.X;'), [], 'an ordinary struct');
  assert.deepEqual(errors('Func<int> f = () => { RS r = new RS(); return r.X; };'), [], 'declared inside the lambda');
  assert.deepEqual(errors('Func<RS, int> f = s => s.X;'), [], 'a ref struct parameter of the lambda itself (Func allows ref struct)');
  assert.deepEqual(errors('int L(RS s) => s.X; L(p);'), [], 'a parameter of the local function itself');
  assert.deepEqual(errors('RS r = new RS(); int x = r.X + p.X;'), []);
});

test('SF-A02-T04.5 an array of a ref struct is CS0611 on the element type, wherever it is written', () => {
  assert.deepEqual(errors('RS[] a = null;'), ['CS0611@RS']);
  assert.deepEqual(errors('var a = new RS[1];'), ['CS0611@RS']);
  assert.deepEqual(errors('', '  static RS[] Make() => null;\n'), ['CS0611@RS']);
  assert.deepEqual(errors('', '  static void N(Span<int>[] spans) { }\n'), ['CS0611@Span<int>']);
});
