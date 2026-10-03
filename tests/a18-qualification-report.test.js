import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {corpusFixtures, canonical, loadGolden} from './fixtures/a18/corpus.js';
import {qualifyFixture} from './fixtures/a18/report.js';

test('source/design/runtime report generation is deterministic and preserves explicit target statuses', () => {
  for (const id of ['01-code-first', '30-style-inheritance', '35-template-partial', '41-unsupported-factory', '49-malformed-constructor']) {
    const fixture = corpusFixtures.find(candidate => candidate.id === id);
    const first = qualifyFixture(fixture);
    const second = qualifyFixture(fixture);
    assert.deepEqual(canonical(first), canonical(second), id);
    assert.deepEqual(canonical(first.golden), canonical(loadGolden(fixture)), id);
    for (const target of ['browser', 'nativeWinUI', 'rustNative', 'rustWasm']) {
      assert.notEqual(first.targets[target].status, 'passed');
      assert.ok(first.targets[target].reason.length > 20);
    }
  }
});

test('published identity report contains exactly the reviewed corpus and honest target counts', () => {
  const report = JSON.parse(readFileSync(new URL('../examples/a18-qualification/designer-roundtrip-report.json', import.meta.url), 'utf8'));
  assert.equal(report.fixtures.length, corpusFixtures.length);
  for (const fixture of corpusFixtures) {
    const entry = report.fixtures.find(candidate => candidate.golden.fixture === fixture.id);
    assert.ok(entry, fixture.id);
    assert.deepEqual(canonical(entry.golden), canonical(loadGolden(fixture)), fixture.id);
    assert.equal(entry.targets.source.status === 'passed', fixture.execute, fixture.id);
    assert.equal(entry.targets.cil.status === 'passed', fixture.execute, fixture.id);
  }
  const executed = corpusFixtures.filter(fixture => fixture.execute).length;
  assert.equal(report.summary.sourceExecuted, executed);
  assert.equal(report.summary.cilExecuted, executed);
});
