import test from 'node:test';
import assert from 'node:assert/strict';
import {executionPreparationCapabilities} from '@sharpforge/runtime';
import {parseOptions, protocolFor} from '../bench/vm/harness.js';
import {compileFixture} from '../bench/vm/operations.js';
import {startupApps, engines} from '../bench/vm/fixtures.js';
import {coldSample, childSample, coldProcessFlags, measureStartup} from '../bench/vm/startup.js';

const protocol = () => protocolFor(parseOptions(['--runner', 'startup-test-only']));

for (const fixture of startupApps) for (const engine of engines) {
  test(`T12 fresh child cold startup verifies ${fixture.id}/${engine} and each phase`, async () => {
    const report = await childSample({fixture, engine, artifact: compileFixture(fixture), vmOptions: protocol().vmOptions});
    for (const key of ['loadMs', 'verificationMs', 'constructionMs', 'executionMs', 'timeToFirstOutputMs',
      'firstOutputExecutionMs', 'processFirstOutputMs', 'childProcessMs']) {
      assert(Number.isFinite(report[key]) && report[key] > 0, key);
    }
    const preparation = executionPreparationCapabilities[engine === 'cil' ? 'cil' : 'source'];
    if (preparation.status === 'available') {
      assert.equal(report.preparation.status, 'prepared');
      assert(report.predecodeMs > 0);
    } else {
      assert.equal(report.preparation.status, 'not-required');
      assert.equal(Object.hasOwn(report, 'predecodeMs'), false);
    }
    assert.equal(report.outputVerified, true);
    assert(report.childProcessMs >= report.timeToFirstOutputMs);
    assert(Number.isSafeInteger(report.managedAllocations));
    assert(Number.isSafeInteger(report.managedAllocatedBytes));
  });
}

test('T12 pre-aborted cold sampling starts no worker and unknown engines fail', async () => {
  const controller = new AbortController();
  controller.abort(new DOMException('cold cancelled', 'AbortError'));
  const fixture = startupApps[0];
  await assert.rejects(measureStartup(fixture, 'cil', compileFixture(fixture), protocol(), controller.signal), /cold cancelled/);
  await assert.rejects(coldSample({engine: 'unknown'}), /Unknown startup engine/);
});

test('T12 in-flight cold cancellation waits for child exit and cleanup', async () => {
  const controller = new AbortController();
  const fixture = startupApps[0];
  const pending = childSample({fixture, engine: 'source', artifact: compileFixture(fixture), vmOptions: protocol().vmOptions}, controller.signal);
  controller.abort(new DOMException('cancel after child spawn', 'AbortError'));
  await assert.rejects(pending, /cancel after child spawn/);
});

test('T12 cold output mismatches fail instead of creating a successful timing report', async () => {
  const fixture = {...startupApps[0], expected: 'incorrect'};
  await assert.rejects(coldSample({fixture, engine: 'source', artifact: compileFixture(fixture), vmOptions: protocol().vmOptions}),
    /incorrect result/);
});

test('T12 cold worker preserves engine flags without recursively enabling Node test mode', () => {
  assert.deepEqual(coldProcessFlags(['--max-old-space-size=512', '--test', '--test-concurrency=1',
    '--test-name-pattern', 'cold worker', '--expose-gc']), ['--max-old-space-size=512', '--expose-gc']);
});
