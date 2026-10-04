import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

/** The fields CS0649 ("never assigned to") is reported for. */
function neverAssigned(source, options) {
  return compile(source, options)
    .diagnostics.filter(d => d.code === 'CS0649')
    .map(d => source.slice(d.start, d.start + d.length));
}
const main = 'class Program { static void Main() { } }\n';

test('SF-A02-B01 corpus: the two gate fixtures no longer report an extra CS0649', () => {
  const pinned = loadPinned();
  for (const id of ['language-version/gate-movable-fixed-buffers-at-7-2', 'language-version/gate-ref-fields-at-10']) {
    const fixture = loadFixtures().find(f => f.id === id);
    assert(fixture, id);
    const row = runFixture(fixture, pinned.results.get(id));
    assert.equal(row.passed, true, `${id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T34 CS0649: a ref field has no default value to warn about', () => {
  assert.deepEqual(neverAssigned('ref struct S { public ref int X; public int Y; }\n' + main), ['Y']);
});

test('SF-A02-T34 CS0649: indexing a fixed-size buffer writes the variable that holds it', () => {
  const buffer = 'unsafe struct S { public fixed int Data[4]; public int Other; }\n';
  const indexed = buffer + 'class A { static S s; static unsafe int M() { return s.Data[0]; } }\n' + main,
    untouched = buffer + 'class A { static S s; static int M() { return s.Other; } }\n' + main;
  assert.deepEqual(neverAssigned(indexed, { allowUnsafe: true }), ['Other']);
  assert.deepEqual(neverAssigned(untouched, { allowUnsafe: true }), ['Other', 's'], 'a field that is only read is still reported');
});
