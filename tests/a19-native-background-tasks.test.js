import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildServices } from '../apps/studio/workbench/build.js';
import { TaskCenter } from '../apps/studio/workbench/task-center.js';
import { BackgroundTaskBridge } from '../apps/studio/workbench/background-tasks.js';
import { NativeTaskBridge } from '../apps/studio/workbench/native-task-bridge.js';
import { MSBuildTools } from '../apps/studio/msbuild-tools.js';
import { deferred } from './a19-session-fixtures.js';

function job(id, status = 'running', extra = {}) {
  return { id, status, request: { action: 'build', project: 'App.csproj', properties: { Token: 'do-not-retain' } },
    events: [], nextCursor: 1, diagnostics: [], artifacts: [], ...extra };
}

function fixture() {
  const tasks = new TaskCenter();
  const builds = new BuildServices();
  const errors = [];
  const bridge = new BackgroundTaskBridge({ tasks, builds, onError: error => errors.push(error) });
  return { tasks, builds, bridge, errors, dispose() { bridge.dispose(); builds.dispose(); tasks.dispose(); } };
}

test('actual MSBuildTools onJob notifications retain exact cancellation ownership when another job is selected', async () => {
  const current = fixture();
  const cancelled = [];
  const client = { async cancel(id) { cancelled.push(id); return job(id, 'cancelled'); }, disconnect() {} };
  const native = new MSBuildTools({ onJob: snapshot => current.bridge.nativeJob(snapshot,
    { owner: client, cancel: () => client.cancel(snapshot.id) }) });
  native.client = client;
  native.accept(job('first'));
  const first = current.tasks.running[0];
  native.accept(job('second'));
  assert.equal(native.job.id, 'second');
  current.tasks.cancel(first.id);
  await current.bridge.settled;
  assert.deepEqual(cancelled, ['first']);
  assert.equal(native.job.id, 'second');
  assert.equal(current.tasks.running.length, 1);
  assert.equal(current.tasks.list()[0].status, 'cancelled');
  assert.equal(current.tasks.list()[1].status, 'running');
  assert.equal(current.tasks.list()[1].progress, null);
  assert.doesNotMatch(JSON.stringify(current.tasks.list()), /do-not-retain|Token|properties/);
  native.accept(job('second', 'succeeded'));
  assert.equal(current.tasks.running.length, 0);
  assert.equal(current.tasks.list()[1].status, 'completed');
  native.dispose();
  current.dispose();
});

test('owners with the same remote job id remain independent and known terminal callbacks cannot resurrect a task', async () => {
  const current = fixture();
  const firstOwner = {}, secondOwner = {};
  const first = current.bridge.nativeJob(job('same-id'), { owner: firstOwner, cancel: () => job('same-id', 'cancelled') });
  const second = current.bridge.nativeJob(job('same-id'), { owner: secondOwner, cancel: () => job('same-id', 'cancelled') });
  assert.notEqual(first, second);
  current.tasks.cancel(first);
  await current.bridge.settled;
  assert.equal(current.tasks.running[0].id, second);
  assert.equal(current.bridge.nativeJob(job('same-id'), { owner: firstOwner, cancel() {} }), null);
  assert.equal(current.tasks.list().length, 2);
  current.bridge.nativeJob(job('same-id', 'failed', { error: 'MSBuild failed' }), { owner: secondOwner });
  assert.equal(current.tasks.list()[1].error, 'MSBuild failed');
  current.dispose();
});

test('phase text stays indeterminate, only host-reported fractions become progress, and stale cursors/phases are ignored', () => {
  const current = fixture();
  const owner = {};
  const options = { owner, cancel() {} };
  const id = current.bridge.nativeJob(job('progress', 'queued', { nextCursor: 0 }), options);
  assert.equal(current.tasks.list()[0].message, 'queued');
  assert.equal(current.tasks.list()[0].progress, null);
  current.bridge.nativeJob(job('progress', 'running', { nextCursor: 3, progress: 0.25 }), options);
  current.bridge.nativeJob(job('progress', 'queued', { nextCursor: 4 }), options);
  current.bridge.nativeJob(job('progress', 'running', { nextCursor: 1, progress: 0.1 }), options);
  assert.equal(current.tasks.list()[0].progress, 0.25);
  assert.equal(current.tasks.list()[0].message, 'running');
  current.bridge.nativeJob(job('progress', 'succeeded', { nextCursor: 5 }), options);
  assert.equal(current.tasks.list()[0].id, id);
  assert.equal(current.tasks.list()[0].status, 'completed');
  current.dispose();
});

test('a native success that wins a cancellation race remains an observed success', async () => {
  const current = fixture();
  const response = deferred();
  const owner = {};
  const id = current.bridge.nativeJob(job('race'), { owner, cancel: () => response.promise });
  current.tasks.cancel(id);
  assert.equal(current.tasks.list()[0].status, 'cancelling');
  response.resolve(job('race', 'succeeded'));
  await current.bridge.settled;
  assert.equal(current.tasks.list()[0].status, 'completed');
  current.dispose();
});

test('native cancellation failures and replies for another job are explicit and cannot alter that other task', async () => {
  const current = fixture();
  const owner = {};
  const first = current.bridge.nativeJob(job('denied'), { owner, cancel: () => Promise.reject(new Error('Permission denied')) });
  current.tasks.cancel(first);
  await current.bridge.settled;
  assert.equal(current.tasks.list()[0].status, 'failed');
  assert.match(current.errors[0].message, /Permission denied/);
  const second = current.bridge.nativeJob(job('wrong-reply'), { owner, cancel: () => job('unrelated', 'cancelled') });
  current.tasks.cancel(second);
  await current.bridge.settled;
  assert.match(current.errors[1].message, /different job/);
  assert.equal(current.tasks.list().length, 2);
  assert.equal(current.tasks.list()[1].status, 'failed');
  current.dispose();
});

test('transport failure settles only its matching observed job and malformed snapshots do not mutate task state', () => {
  const current = fixture();
  const owner = {};
  current.bridge.nativeJob(job('network'), { owner, cancel() {} });
  current.bridge.nativeJob(job('retained'), { owner, cancel() {} });
  assert.equal(current.bridge.nativeFailure('network', new Error('Connection lost'), { owner }), true);
  assert.equal(current.tasks.list()[0].error, 'Connection lost');
  for (const invalid of [job('', 'running'), job('bad', 'unknown'), job('bad', 'running', { progress: 2 }),
    job('bad', 'running', { nextCursor: -1 })]) assert.equal(current.bridge.nativeJob(invalid, { owner, cancel() {} }), null);
  assert.equal(current.tasks.list().length, 2);
  assert.equal(current.tasks.running.length, 1);
  assert.equal(current.errors.length, 4);
  current.bridge.nativeJob(job('retained', 'succeeded'), { owner });
  current.dispose();
});

test('synchronous cancellation from first notification reaches the captured client exactly once', async () => {
  const current = fixture();
  let cancelled = 0;
  current.tasks.subscribe(event => { if (event.type === 'started') current.tasks.cancel(event.task.id); });
  current.bridge.nativeJob(job('synchronous'), { owner: {}, cancel: () => { cancelled++; return job('synchronous', 'cancelled'); } });
  await current.bridge.settled;
  assert.equal(cancelled, 1);
  assert.equal(current.tasks.list()[0].status, 'cancelled');
  assert.equal(current.tasks.running.length, 0);
  current.dispose();
});

test('disposal aborts owned requests once, ignores late callbacks and bounds retained terminal identity history', async () => {
  const tasks = new TaskCenter({ limit: 3 });
  const errors = [];
  const bridge = new NativeTaskBridge({ tasks, onError: error => errors.push(error), historyLimit: 2 });
  const owner = {};
  for (let index = 0; index < 6; index++) bridge.update(job(String(index), 'succeeded'), { owner });
  assert.equal(bridge.finished.size, 2);
  assert.equal(tasks.list().length, 3);
  let cancelled = 0;
  const response = deferred();
  bridge.update(job('dispose'), { owner, cancel: () => { cancelled++; return response.promise; } });
  bridge.dispose();
  bridge.dispose();
  response.resolve(job('dispose', 'cancelled'));
  await bridge.settled;
  assert.equal(cancelled, 1);
  assert.equal(bridge.update(job('late'), { owner, cancel() {} }), null);
  assert.equal(tasks.running.length, 0);
  assert.equal(bridge.active.size, 0);
  assert.deepEqual(errors, []);
  tasks.dispose();
});
