import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgram} from './a19-runtime-programs.js';
import {connectRuntimeWorker} from './a19-runtime-worker-client.js';
import {validateExecutionBatch} from '../apps/studio/workbench/tools/execution-capture.js';

const source = `using System;
class Program {
  static void Main() {
    int total = 0;
    for (int i = 0; i < 5000; i++) total += i;
    Console.WriteLine(total);
  }
}`;

async function state(worker, launch, expected) {
  const event = await worker.wait(event => event.event === 'state' && event.sessionId === launch.sessionId &&
    (event.state === expected || event.state === 'faulted'));
  assert.equal(event.state, expected, JSON.stringify(event.fault ?? event.reason));
  return event;
}

for (const managedIL of [false, true]) {
  const engine = managedIL ? 'direct CIL' : 'source';

  test('real ' + engine + ' worker exposes actual execution intervals and preserves program output', async test => {
    const compiled = compileProgram(source, {includeDebug: true});
    const worker = connectRuntimeWorker(test);
    await worker.ready();
    const launch = await worker.request('launch', {assembly: compiled.assembly, managedIL, debug: false});
    const final = await state(worker, launch, 'terminated');
    assert.equal(final.output, '12497500\n');
    const metrics = await worker.request('executionMetrics', {sessionId: launch.sessionId, after: 0, limit: 256});
    validateExecutionBatch(metrics, {sessionId: launch.sessionId});
    assert.equal(metrics.active, false);
    assert.ok(metrics.totalBusyMs > 0);
    assert.ok(metrics.samples.some(sample => sample.managedMs > 0));
    assert.ok(metrics.samples.every(sample => sample.occupancyPercent >= 0 && sample.occupancyPercent <= 100));
    assert.deepEqual(await worker.request('executionMetrics', {sessionId: launch.sessionId, after: metrics.sequence}), {
      ...metrics, samples: []
    });
  });

  test('real ' + engine + ' workers isolate captures, pause, stop and replacement despite equal raw serials', async test => {
    const compiled = compileProgram(source, {includeDebug: true});
    const first = connectRuntimeWorker(test), second = connectRuntimeWorker(test);
    await Promise.all([first.ready(), second.ready()]);
    const options = {assembly: compiled.assembly, managedIL, debug: true, stopOnEntry: true};
    const alpha = await first.request('launch', options), beta = await second.request('launch', options);
    await Promise.all([state(first, alpha, 'paused'), state(second, beta, 'paused')]);
    assert.equal(alpha.sessionId, 1);
    assert.equal(beta.sessionId, 1);
    await first.request('stop', {sessionId: alpha.sessionId});
    const stopped = await first.request('executionMetrics', {sessionId: alpha.sessionId});
    const paused = await second.request('executionMetrics', {sessionId: beta.sessionId});
    assert.equal(stopped.active, false);
    assert.equal(paused.active, true);
    await second.request('resume', {sessionId: beta.sessionId, mode: 'continue'});
    assert.equal((await state(second, beta, 'terminated')).output, '12497500\n');
    const completed = await second.request('executionMetrics', {sessionId: beta.sessionId});
    validateExecutionBatch(completed, {sessionId: beta.sessionId});
    assert.equal(completed.active, false);
    assert.ok(completed.totalBusyMs >= paused.totalBusyMs);
    assert.deepEqual(await first.request('executionMetrics', {sessionId: alpha.sessionId}), stopped);
    const replacement = await first.request('launch', {...options, debug: false, stopOnEntry: false});
    assert.equal(replacement.sessionId, 2);
    await state(first, replacement, 'terminated');
    const replaced = await first.request('executionMetrics', {sessionId: replacement.sessionId});
    assert.equal(replaced.samples[0].sequence, 1);
    assert.equal(replaced.samples[0].startMs, 0);
    assert.ok(replaced.samples.every(sample => sample.sessionId === replacement.sessionId));
    await assert.rejects(first.request('executionMetrics', {sessionId: alpha.sessionId}), /session changed/);
  });
}
