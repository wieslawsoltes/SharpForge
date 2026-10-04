import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildServices } from '../apps/studio/workbench/build.js';
import { TaskCenter } from '../apps/studio/workbench/task-center.js';
import { BackgroundTaskBridge } from '../apps/studio/workbench/background-tasks.js';
import { subscribeShellServices } from '../apps/studio/workbench/shell-events.js';
import { fakeWorkers, compileResult } from './a19-session-fixtures.js';

function fixture({ attach = true, limit = 100 } = {}) {
  const fake = fakeWorkers();
  const builds = new BuildServices({ workerFactory: fake.factory });
  const a = builds.register({ id: 'A', files: [] });
  const b = builds.register({ id: 'B', files: [] });
  const tasks = new TaskCenter({ limit });
  const errors = [];
  const bridge = attach ? new BackgroundTaskBridge({ tasks, builds, onError: error => errors.push(error) }) : null;
  return { fake, builds, a, b, tasks, bridge, errors,
    dispose() { bridge?.dispose(); builds.dispose(); tasks.dispose(); } };
}

test('actual analysis events create separate tasks; cancelling one preserves same-project build and other project analysis', async () => {
  const current = fixture();
  const { a, b, builds, bridge, fake, tasks } = current;
  const disposeBuildTasks = subscribeShellServices({ tasks, services: { builds },
    invalidateTool() {}, updateContext() {}, taskListDirty: false });
  builds.setActive('B');
  const build = a.build();
  const analyzeA = a.analyze();
  const analyzeB = b.analyze();
  assert.deepEqual(tasks.running.map(row => row.label), ['Build A', 'Analyze A', 'Analyze B']);
  const selected = tasks.running.find(row => row.label === 'Analyze A');
  assert.equal(tasks.cancel(selected.id), true);
  await assert.rejects(analyzeA, { name: 'AbortError' });
  assert.equal(fake.workers[0].terminated, false);
  assert.equal(a.worker.pending.size, 1);
  assert.equal(b.worker.pending.size, 1);
  fake.workers[0].reply(1, compileResult());
  fake.workers[1].reply(1, compileResult());
  await Promise.all([build, analyzeB]);
  assert.equal(builds.activeId, 'B');
  assert.equal(tasks.running.length, 0);
  assert.deepEqual(tasks.list().map(row => row.status), ['completed', 'cancelled', 'completed']);
  assert.equal(a.buildResult.success, true);
  assert.equal(a.analysisResult, null);
  assert.equal(b.analysisResult.success, true);
  assert.equal(bridge.analyses.size, 0);
  disposeBuildTasks();
  current.dispose();
});

test('superseded analysis settles once, drops late worker replies and preserves the legacy successful analysis event', async () => {
  const current = fixture();
  const { a, fake, builds, tasks } = current;
  const events = [];
  builds.subscribe(event => { if (event.type.startsWith('analysis')) events.push(event); });
  const first = a.analyze();
  const firstEpoch = a.analysisOperation.epoch;
  const second = a.analyze();
  const secondEpoch = a.analysisOperation.epoch;
  assert.equal(await first, null);
  assert.equal(a.cancelAnalysis('Old toolbar callback', { epoch: firstEpoch }), false);
  assert.equal(a.analysisOperation.epoch, secondEpoch);
  fake.workers[0].reply(1, compileResult(false));
  const final = compileResult();
  fake.workers[0].reply(2, final);
  assert.equal(await second, final);
  assert.deepEqual(events.map(event => event.type), [
    'analysis-started', 'analysis-cancelled', 'analysis-started', 'analysis', 'analysis-completed'
  ]);
  assert.equal(events.filter(event => event.epoch === firstEpoch && event.type !== 'analysis-started').length, 1);
  assert.deepEqual(tasks.list().map(row => row.status), ['cancelled', 'completed']);
  assert.equal(a.result, final);
  assert.equal(a.buildResult, null);
  current.dispose();
});

test('source invalidation cancels only that request and stale results cannot change diagnostics or task state', async () => {
  const current = fixture();
  const pending = current.a.analyze();
  current.a.invalidate();
  assert.equal(await pending, null);
  assert.equal(current.tasks.list()[0].status, 'cancelled');
  current.fake.workers[0].reply(1, compileResult());
  assert.equal(current.a.result, null);
  assert.equal(current.a.analyzing, false);
  current.dispose();
});

test('worker errors and malformed compiler results close failed analysis entries without losing future analyses', async () => {
  const current = fixture();
  const first = current.a.analyze();
  current.fake.workers[0].reply(1, null, new Error('Compiler transport failed'));
  await assert.rejects(first, /Compiler transport failed/);
  const second = current.a.analyze();
  current.fake.workers[0].reply(2, { success: true });
  await assert.rejects(second, /Malformed compiler result/);
  const third = current.a.analyze();
  current.fake.workers[0].reply(3, compileResult(false));
  assert.equal((await third).success, false);
  assert.deepEqual(current.tasks.list().map(row => row.status), ['failed', 'failed', 'completed']);
  assert.equal(current.a.analyzing, false);
  assert.equal(current.bridge.analyses.size, 0);
  current.dispose();
});

test('pre-aborted and malformed signals refuse before creating tasks; external cancellation is observable', async () => {
  const current = fixture();
  const aborted = new AbortController();
  aborted.abort('Already cancelled');
  await assert.rejects(current.a.analyze({ signal: aborted.signal }), { name: 'AbortError' });
  await assert.rejects(current.a.analyze({ signal: {} }), /abort subscriptions/);
  assert.equal(current.tasks.list().length, 0);
  const active = new AbortController();
  const pending = current.a.analyze({ signal: active.signal });
  active.abort(new Error('User changed operation'));
  await assert.rejects(pending, { name: 'AbortError', message: 'User changed operation' });
  assert.equal(current.tasks.list()[0].status, 'cancelled');
  assert.equal(current.a.worker.pending.size, 0);
  current.dispose();
});

test('a bridge attached after a request starts observes its real epoch and project removal disposes its task', async () => {
  const current = fixture({ attach: false });
  const pending = current.b.analyze();
  const bridge = new BackgroundTaskBridge({ tasks: current.tasks, builds: current.builds });
  assert.equal(current.tasks.running[0].projectId, 'B');
  current.builds.remove('B');
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(current.tasks.running.length, 0);
  assert.equal(bridge.analyses.size, 0);
  bridge.dispose();
  current.dispose();
});

test('TaskCenter quota refuses an untracked analysis while retaining the other running operation', async () => {
  const current = fixture({ limit: 1 });
  const first = current.a.analyze();
  await assert.rejects(current.b.analyze(), { name: 'AbortError' });
  assert.match(current.errors[0].message, /Too many concurrent/);
  assert.equal(current.tasks.running.length, 1);
  assert.equal(current.tasks.running[0].projectId, 'A');
  assert.equal(current.fake.workers[1].requests.length, 0);
  current.fake.workers[0].reply(1, compileResult());
  await first;
  current.dispose();
});

test('synchronous cancellation from task notification and bridge disposal leave no orphan analysis', async () => {
  const current = fixture();
  const unsubscribe = current.tasks.subscribe(event => {
    if (event.type === 'started') current.tasks.cancel(event.task.id);
  });
  await assert.rejects(current.a.analyze(), { name: 'AbortError' });
  assert.equal(current.fake.workers[0].requests.length, 0);
  assert.equal(current.tasks.running.length, 0);
  unsubscribe();
  const pending = current.b.analyze();
  current.bridge.dispose();
  current.bridge.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(current.tasks.running.length, 0);
  assert.equal(current.b.worker.pending.size, 0);
  current.dispose();
});
