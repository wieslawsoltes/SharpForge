import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildServices } from '../apps/studio/workbench/build.js';
import { BuildQueue } from '../apps/studio/workbench/build-queue.js';
import { OutputChannels } from '../apps/studio/workbench/output-channels.js';
import { TaskCenter } from '../apps/studio/workbench/task-center.js';
import { subscribeShellServices } from '../apps/studio/workbench/shell-events.js';
import { fakeWorkers, compileResult, settle } from './a19-session-fixtures.js';

function fixture(t, limit = 100) {
  const workers = fakeWorkers();
  const output = new OutputChannels();
  const builds = new BuildServices({ workerFactory: workers.factory, output });
  for (const id of ['A', 'B', 'C']) builds.register({ id, files: [] });
  const queue = new BuildQueue(builds, { output });
  const tasks = new TaskCenter({ limit });
  const errors = [];
  const disconnect = subscribeShellServices({ tasks, services: { builds, queue }, taskListDirty: false,
    invalidateTool() {}, updateContext() {}, onError: error => errors.push(error) });
  const reply = id => {
    const worker = builds.get(id).worker.worker;
    worker.reply(worker.requests.at(-1).id, compileResult());
  };
  t.after(() => { disconnect(); queue.dispose(); builds.dispose(); tasks.dispose(); output.dispose(); });
  return { workers, output, builds, queue, tasks, disconnect, reply, errors };
}

test('actual TaskCenter Cancel aborts its whole two-project queue and leaves an independent queue running', async t => {
  const current = fixture(t);
  const first = current.queue.run(['A', 'B']);
  const independent = current.queue.run(['C']);
  await settle();
  const task = current.tasks.running.find(value => value.projectId === 'A');
  assert.equal(current.tasks.cancel(task.id), true);
  const summary = await first;
  assert.deepEqual(summary.cancelled, ['A']);
  assert.deepEqual(summary.skipped, ['B']);
  assert.equal(current.builds.get('B').worker.worker.requests.length, 0);
  assert.equal(current.builds.get('C').worker.worker.terminated, false);
  assert.equal(current.builds.get('C').busy, true);
  current.reply('C');
  assert.deepEqual((await independent).succeeded, ['C']);
  assert.match(current.output.text('Build'), /0 succeeded, 0 failed, 1 skipped, 1 cancelled/);
});

test('a queued second operation for the same project survives cancellation of the first captured queue', async t => {
  const current = fixture(t);
  const first = current.queue.run(['A', 'B']);
  const second = current.queue.run(['A']);
  await settle();
  current.tasks.cancel(current.tasks.running[0].id);
  assert.deepEqual((await first).skipped, ['B']);
  await settle();
  assert.equal(current.tasks.running.length, 1);
  assert.equal(current.tasks.running[0].projectId, 'A');
  current.reply('A');
  assert.deepEqual((await second).succeeded, ['A']);
});

test('a completed task callback cannot cancel the next project or a later build with the same project id', async t => {
  const current = fixture(t);
  const first = current.queue.run(['A', 'B']);
  await settle();
  const task = current.tasks.running[0];
  const staleCancel = task.cancel;
  current.reply('A');
  await settle();
  assert.equal(staleCancel(), false);
  assert.equal(current.builds.get('B').busy, true);
  current.reply('B');
  assert.deepEqual((await first).succeeded, ['A', 'B']);
  current.builds.get('A').invalidate();
  const second = current.queue.run(['A']);
  await settle();
  assert.equal(staleCancel(), false);
  assert.equal(current.builds.get('A').busy, true);
  current.reply('A');
  await second;
});

test('TaskCenter cancellation during its started notification sends no request and skips the rest of the queue', async t => {
  const current = fixture(t);
  const unsubscribe = current.tasks.subscribe(event => {
    if (event.type === 'started') current.tasks.cancel(event.task.id);
  });
  const summary = await current.queue.run(['A', 'B']);
  unsubscribe();
  assert.deepEqual(summary.cancelled, ['A']);
  assert.deepEqual(summary.skipped, ['B']);
  assert.equal(current.workers.workers.some(worker => worker.requests.length), false);
  assert.equal(current.tasks.list()[0].status, 'cancelled');
});

test('standalone build cancellation preserves the other worker and disposal settles only tracked operations', async t => {
  const current = fixture(t);
  const first = current.builds.get('A').build();
  const other = current.builds.get('C').build();
  current.tasks.cancel(current.tasks.running.find(task => task.projectId === 'A').id);
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(current.builds.get('C').worker.worker.terminated, false);
  current.reply('C');
  await other;
  const pending = current.queue.run(['A', 'B']);
  await settle();
  current.disconnect();
  assert.deepEqual((await pending).skipped, ['B']);
  assert.equal(current.tasks.running.length, 0);
});

test('build task quota cancels only the untrackable queue and reports the refusal', async t => {
  const current = fixture(t, 1);
  const first = current.queue.run(['A']);
  await settle();
  const second = await current.queue.run(['B', 'C']);
  assert.deepEqual(second.cancelled, ['B']);
  assert.deepEqual(second.skipped, ['C']);
  assert.equal(current.tasks.running[0].projectId, 'A');
  assert.match(current.errors[0].message, /Too many concurrent/);
  current.reply('A');
  await first;
});
