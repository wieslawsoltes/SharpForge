import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOptions, protocolFor} from '../bench/vm/harness.js';
import {compileFixture} from '../bench/vm/operations.js';
import {measureSnapshot, portableSnapshotsAvailable} from '../bench/vm/snapshot.js';
import {metricPlan} from '../bench/vm/metric-contracts.js';

const fixture = {id: 'snapshot-replay-test-only', boundaryOutput: 'snapshot\n', expected: 'snapshot\n7\n',
  source: 'int[] values=new int[4];for(int i=0;i<4;i++){values[i]=i;}Console.WriteLine("snapshot");' +
    'values[0]=1;int sum=0;for(int i=0;i<4;i++){sum+=values[i];}Console.WriteLine(sum);'};
const protocol = () => ({...protocolFor(parseOptions(['--runner', 'snapshot-test-only'])), warmup: 1, samples: 1});

for (const engine of ['source', 'reloaded', 'cil']) {
  test(`T12 populated ${engine} snapshot replay preserves output after a guest heap write`, async () => {
    const row = await measureSnapshot(fixture, engine, compileFixture(fixture), protocol());
    assert.equal(row.status, 'measured');
    assert.equal(row.samples.length, 3);
    for (const sample of row.samples) {
      assert(sample.captureMs > 0);
      assert(sample.restoreMs > 0);
      assert(sample.replayMs > 0);
      assert.equal(sample.outputVerified, true);
      if (portableSnapshotsAvailable()) {
        assert(sample.exportMs > 0);
        assert(sample.structuredCopyMs > 0);
        assert(sample.importRestoreMs > 0);
        assert.equal(sample.portableOutputVerified, true);
        assert(sample.wireBytes > 0);
      } else {
        for (const key of ['exportMs', 'structuredCopyMs', 'importRestoreMs']) {
          assert.equal(Object.hasOwn(sample, key), false);
          assert.equal(row.unavailableMetrics[key].status, 'unsupported');
        }
      }
    }
  });
}

test('T12 absent portable APIs have explicit unavailable phases and no fake zero-duration metrics', () => {
  const plan = metricPlan('snapshot', 'source', {...protocol(), portableSnapshots: false});
  assert.equal(Object.hasOwn(plan.metrics, 'exportMs'), false);
  assert.equal(plan.unavailableMetrics.exportMs.status, 'unsupported');
  assert.match(plan.unavailableMetrics.exportMs.reason, /unavailable/);
});

test('T12 cancelled snapshot capture rejects before running the guest', async () => {
  const abort = new AbortController();
  abort.abort(new DOMException('snapshot cancelled', 'AbortError'));
  await assert.rejects(measureSnapshot(fixture, 'source', compileFixture(fixture), protocol(), abort.signal), /snapshot cancelled/);
});

test('T12 a missing snapshot boundary is a failed case', async () => {
  const missing = {...fixture, boundaryOutput: 'never produced'};
  await assert.rejects(measureSnapshot(missing, 'source', compileFixture(fixture), protocol()), /populated heap boundary/);
});
