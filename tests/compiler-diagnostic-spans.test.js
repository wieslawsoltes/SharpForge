import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

const codesOf = (source, options) =>
  compile(source, options)
    .diagnostics.filter(d => /^CS/.test(d.code))
    .map(d => `${d.code}@${source.slice(d.start, d.start + d.length)}`);

test('SF-A02 corpus: diagnostic-spans fixtures match Roslyn', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.feature === 'diagnostic-spans');
  assert.equal(fixtures.length, 5);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T07 argument-count diagnostics sit on the invoked name', () => {
  const delegates = 'using System;\nFunc<int, int> f = x => x;\nConsole.WriteLine(f(1, 2));\nConsole.WriteLine(f());\n';
  assert.deepEqual(codesOf(delegates), ['CS1593@f', 'CS7036@f']);
  assert.deepEqual(codesOf('using System;\nConsole.WriteLine("abc".Substring(1, 2, 3));\n'), ['CS1501@Substring']);
});

test('SF-A02-B01 gates: async on the name or the keyword, discard patterns, dynamic before C# 4', () => {
  const asyncForms = 'class P { static async System.Threading.Tasks.Task M() { System.Action a = async () => { }; } static void Main() { } }';
  assert.deepEqual(codesOf(asyncForms, { langVersion: '4' }), ['CS8025@M', 'CS8025@async']);
  assert.deepEqual(codesOf(asyncForms, { langVersion: '5' }), []);
  const discard = 'class P { static string M(int n) => n switch { 1 => "one", _ => "other" }; static void Main() { } }';
  assert.deepEqual(codesOf(discard, { langVersion: '7.3' }), ['CS8370@switch', 'CS8370@_']);
  assert.deepEqual(codesOf(discard, { langVersion: '8' }), []);
  const dynamic = 'class P { static void Main() { dynamic d = 1; d = 2; } }';
  assert.deepEqual(codesOf(dynamic, { langVersion: '3' }), ['CS0246@dynamic']);
  assert.deepEqual(codesOf(dynamic, { langVersion: '4' }), []);
});
