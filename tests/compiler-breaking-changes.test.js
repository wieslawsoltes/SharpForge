import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { breakingChanges, fixtureIdOf } from '../packages/compiler/test/conformance/breaking-changes/index.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus-store.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

// SF-A02-T12.1: the breaking-change regression corpus. Every change is one source at its old and at its new language
// version, each pinned against Roslyn. The table below is the list of sides where SharpForge does not match yet,
// with the reason; a side that starts matching must be removed from it (the test then fails).

const knownGaps = {
  'breaking-changes/foreach-capture-csharp-4': 'needs anonymous methods over List<Func<int>> in the execution profile',
  'breaking-changes/foreach-capture-csharp-5': 'needs anonymous methods over List<Func<int>> in the execution profile',
  'breaking-changes/target-typed-conditional-csharp-9': 'needs Nullable<T> at run time',
};

const fixtures = new Map(loadFixtures().map(fixture => [fixture.id, fixture])),
  pinned = loadPinned().results;
const sides = breakingChanges.flatMap(change => ['old', 'new'].map(side => ({ change, side, id: fixtureIdOf(change, side) })));
const resultOf = pin => JSON.stringify([pin.diagnostics, pin.output ?? null]);

test('A02-T12.1 corpus: every change has both versions pinned against Roslyn', () => {
  assert(breakingChanges.length >= 7);
  assert.equal(new Set(breakingChanges.map(change => change.id)).size, breakingChanges.length);
  for (const { change, side, id } of sides) {
    const fixture = fixtures.get(id),
      pin = pinned.get(id);
    assert(fixture && pin, `${id}: not in the differential corpus or not pinned`);
    assert.equal(fixture.langVersion, change[side].langVersion);
    assert.equal(pin.kind, change[side].kind);
    assert.match(change.reference, /^https:\/\//);
  }
});

test('A02-T12.1 Roslyn behaves differently at the old and at the new version (unless the change is marked version-independent)', () => {
  for (const change of breakingChanges) {
    const before = pinned.get(fixtureIdOf(change, 'old')),
      after = pinned.get(fixtureIdOf(change, 'new'));
    if (change.sameInRoslyn) assert.equal(resultOf(before), resultOf(after), change.id);
    else assert.notEqual(resultOf(before), resultOf(after), `${change.id}: the pinned Roslyn does not distinguish the versions`);
  }
});

for (const { change, side, id } of sides) {
  const label = `${change.id} at C# ${change[side].langVersion} (${side} behaviour)`;
  if (id in knownGaps) {
    test(`A02-T12.1 known gap (${knownGaps[id]}): ${label}`, () => {
      const row = runFixture(fixtures.get(id), pinned.get(id));
      assert.equal(row.passed, false, `${id} matches Roslyn now: remove it from knownGaps`);
    });
    continue;
  }
  test(`A02-T12.1 matches Roslyn: ${label}`, () => {
    const row = runFixture(fixtures.get(id), pinned.get(id));
    assert.equal(row.passed, true, JSON.stringify(row.details));
  });
}

test('A02-T12.1 a type named like a contextual keyword: reported from the version that introduced the keyword', () => {
  const codes = (name, langVersion) =>
    compile(`class ${name} { } class Program { static void Main() { } }`, { langVersion })
      .diagnostics.filter(d => /^CS/.test(d.code))
      .map(d => `${d.code}:${d.severity}`);
  assert.deepEqual(codes('record', '8'), []);
  assert.deepEqual(codes('record', '9'), ['CS8860:warning']);
  assert.deepEqual([codes('required', '10'), codes('required', '11')], [[], ['CS9029:error']]);
  assert.deepEqual([codes('scoped', '10'), codes('scoped', '11')], [[], ['CS9062:error']]);
  assert.deepEqual([codes('file', '10'), codes('file', '11')], [[], ['CS9056:error']]);
  assert.deepEqual([codes('extension', '13'), codes('extension', '14')], [[], ['CS9306:error']]);
  // An escaped name is an ordinary identifier at every version; a type parameter is checked like a type.
  assert.deepEqual(codes('@required', '14'), []);
  assert.deepEqual(codes('Box<required>', '11'), ['CS9029:error']);
});
