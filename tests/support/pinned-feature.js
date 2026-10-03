import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtures, loadPinned } from '../../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../../packages/compiler/test/differential/harness.js';
import { semanticRow } from '../../packages/compiler/test/differential/tools/semantic-report.mjs';

/**
 * Registers the two tests every pinned differential feature gets:
 *   - the semantic analysis reports exactly the errors Roslyn reports for each fixture of the feature;
 *   - each output fixture prints on the bytecode VM and on the CIL VM what the program prints on .NET.
 * @param {string} workId the work item the tests are named after
 * @param {string} feature the fixture feature id (packages/compiler/test/differential/fixtures)
 * @param {{outputs:number, diagnostics:number}} minimum the least number of fixtures of each kind the feature must have
 */
export function testPinnedFeature(workId, feature, minimum) {
  const fixtures = loadFixtures().filter(fixture => fixture.feature === feature);
  const pinned = loadPinned().results;
  const outputs = fixtures.filter(fixture => fixture.kind === 'output');

  test(`${workId} ${feature}: the semantic analysis reports the errors Roslyn reports`, () => {
    assert.ok(fixtures.length - outputs.length >= minimum.diagnostics, `expected ${minimum.diagnostics} diagnostics fixtures`);
    for (const fixture of fixtures) {
      const expected = pinned.get(fixture.id);
      assert.ok(expected, `${fixture.id} is not pinned`);
      const row = semanticRow(fixture, expected);
      assert.equal(row.crash, undefined, `${fixture.id}: ${row.crash}`);
      assert.equal(row.ok, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
    }
  });

  test(`${workId} ${feature}: output fixtures print what .NET prints on both back ends`, () => {
    assert.ok(outputs.length >= minimum.outputs, `expected ${minimum.outputs} output fixtures, found ${outputs.length}`);
    for (const fixture of outputs) {
      const row = runFixture(fixture, pinned.get(fixture.id));
      assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
    }
  });
}
