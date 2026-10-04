import test from 'node:test';
import assert from 'node:assert/strict';
import { MSBuildClient } from '@sharpforge/msbuild';
import { MSBuildTools } from '../apps/studio/msbuild-tools.js';
import { nativeConfiguration } from '../apps/studio/workbench/lazy-features/native-configuration.js';
import { BackgroundTaskBridge } from '../apps/studio/workbench/background-tasks.js';
import { BuildServices } from '../apps/studio/workbench/build.js';
import { TaskCenter } from '../apps/studio/workbench/task-center.js';
import { deferred } from './a19-session-fixtures.js';

function job(id, status = 'running', extra = {}) {
  return { id, status, nextCursor: 1, events: [], diagnostics: [], artifacts: [],
    request: { project: 'App.csproj', action: 'build' }, ...extra };
}

function client(handler) {
  const requests = [];
  const value = new MSBuildClient({ token: 'a'.repeat(64), fetch: async (url, options) => {
    const path = new URL(url, 'http://localhost').pathname;
    requests.push({ path, method: options.method, authenticated: options.headers.Authorization.length === 71 });
    const result = await handler(path, options);
    return result instanceof Response ? result : Response.json(result);
  } });
  return { value, requests };
}

function fixture(owner, { onJob, nativeMode = false } = {}) {
  const tasks = new TaskCenter();
  const builds = new BuildServices();
  const errors = [];
  const bridge = new BackgroundTaskBridge({ tasks, builds, onError: error => errors.push(error) });
  const events = [];
  const panels = [];
  const context = {
    state: { files: [], nativeMode, nativeJob: null },
    refreshEngineIndicators() {}, setEditorDecorations() {}, renderPanel() {}, status() {},
    setPanel: panel => panels.push(panel), toast: message => errors.push(new Error(message)),
    onNativeJob(snapshot, ownership) {
      events.push({ id: snapshot.id, status: snapshot.status, owner: ownership.owner, selected: ownership.selected });
      bridge.nativeJob(snapshot, ownership);
      onJob?.(snapshot, ownership);
    },
    onNativeJobFailure(id, error, ownership) {
      events.push({ failure: id, owner: ownership.owner });
      bridge.nativeFailure(id, error, ownership);
    }
  };
  const configuration = nativeConfiguration(context);
  const native = new MSBuildTools(configuration);
  native.client = owner;
  native.capabilities = { available: true, trusted: true };
  Object.assign(native.settings, { project: 'App.csproj', trusted: true });
  return { tasks, bridge, builds, native, configuration, context, events, panels, errors,
    async dispose() {
      bridge.dispose();
      await Promise.all([native.dispose(), bridge.settled]);
      builds.dispose();
      tasks.dispose();
    } };
}

test('actual client, MSBuildTools and lazy native callbacks publish live tasks and preserve completed inspection', async () => {
  const host = client(path => path === '/api/msbuild/jobs' ? job('build') : job('build', 'succeeded', {
    nextCursor: 3, events: [{ cursor: 2, text: 'real host event\n' }], result: { Properties: { TargetFramework: 'net8.0' } }
  }));
  const current = fixture(host.value, { nativeMode: true });
  const result = await current.native.run('evaluate');
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(current.events.map(event => event.status), ['running', 'succeeded']);
  assert(current.events.every(event => event.owner === host.value));
  assert.equal(current.tasks.list()[0].status, 'completed');
  assert.equal(current.tasks.list()[0].progress, null);
  assert.equal(current.context.state.result.success, true);
  assert.equal(current.native.log, 'real host event\n');
  assert.equal(current.native.inspection.jobId, 'build');
  assert.deepEqual(current.panels, ['msbuild', 'msbuild-inspector']);
  assert(host.requests.every(request => request.authenticated));
  await current.dispose();
});

test('poll transport failure retains the captured client and fails only that job after another job becomes selected', async () => {
  const first = client(path => path === '/api/msbuild/jobs' ? job('first') :
    Response.json({ error: 'first connection lost' }, { status: 503 }));
  const second = client(() => job('second', 'cancelled'));
  let current;
  current = fixture(first.value, { onJob: snapshot => {
    if (snapshot.id === 'first' && snapshot.status === 'running') {
      current.native.client = second.value;
      current.native.accept(job('second'), { owner: second.value });
    }
  } });
  await assert.rejects(current.native.run(), /first connection lost/);
  assert.equal(current.native.job.id, 'second');
  assert.equal(current.context.state.nativeJob.id, 'second', 'nested notifications retain the newer selected job');
  assert.deepEqual(current.events.filter(event => event.failure).map(event => [event.failure, event.owner]), [['first', first.value]]);
  assert.deepEqual(current.tasks.list().map(row => row.status), ['failed', 'running']);
  assert.equal(second.requests.length, 0);
  assert(first.requests.some(request => request.path === '/api/msbuild/jobs/first'));
  current.native.accept(job('second', 'succeeded'), { owner: second.value });
  await current.dispose();
});

test('the TaskCenter cancellation callback targets its captured client/job and does not replace another native selection', async () => {
  const first = client(path => {
    assert.equal(path, '/api/msbuild/jobs/first/cancel');
    return job('first', 'cancelled', { nextCursor: 2 });
  });
  const second = client(() => job('second', 'cancelled'));
  const current = fixture(first.value);
  current.native.accept(job('first'));
  const task = current.tasks.running[0];
  current.native.client = second.value;
  current.native.accept(job('second'), { owner: second.value });
  current.tasks.cancel(task.id);
  await current.bridge.settled;
  assert.equal(current.native.job.id, 'second');
  assert.equal(current.context.state.nativeJob.id, 'second');
  assert.equal(current.events.at(-1).selected, false);
  assert.deepEqual(current.tasks.list().map(row => row.status), ['cancelled', 'running']);
  assert.equal(first.requests.length, 1);
  assert.equal(second.requests.length, 0);
  current.native.accept(job('second', 'succeeded'), { owner: second.value });
  await current.dispose();
});

test('validation/start failures and ordinary native UI errors cannot settle a previously observed unrelated task', async () => {
  const host = client(path => path.endsWith('/cancel') ? job('old', 'cancelled') :
    Response.json({ error: 'start permission denied' }, { status: 403 }));
  const current = fixture(host.value);
  current.native.accept(job('old'));
  current.native.settings.trusted = false;
  await assert.rejects(current.native.run(), /explicitly trust/);
  current.native.settings.trusted = true;
  await assert.rejects(current.native.run(), /start permission denied/);
  current.configuration.onError(new Error('unrelated file read failed'));
  assert.equal(current.tasks.running.length, 1);
  assert.equal(current.events.some(event => event.failure), false);
  assert.match(current.errors[0].message, /unrelated file read/);
  await current.dispose();
});

test('a poll response for a different ID closes only the requested task and never publishes the foreign job', async () => {
  const host = client(path => path === '/api/msbuild/jobs' ? job('expected') :
    path.endsWith('/cancel') ? job('expected', 'cancelled') : job('foreign', 'succeeded'));
  const current = fixture(host.value);
  await assert.rejects(current.native.run(), /different job/);
  assert.equal(current.tasks.list().length, 1);
  assert.equal(current.tasks.list()[0].status, 'failed');
  assert.deepEqual(current.events.filter(event => event.failure).map(event => event.failure), ['expected']);
  assert.equal(current.events.some(event => event.id === 'foreign'), false);
  await current.dispose();
});

test('native Cancel transport errors report only the captured current owner, regardless of a later client value', async () => {
  const first = client(() => Response.json({ error: 'cancel permission denied' }, { status: 403 }));
  const second = client(() => job('unrelated', 'cancelled'));
  const current = fixture(first.value);
  current.native.accept(job('cancel'));
  current.native.client = second.value;
  await assert.rejects(current.native.cancel(), /cancel permission denied/);
  assert.equal(current.tasks.list()[0].status, 'failed');
  assert.equal(current.events.at(-1).owner, first.value);
  assert.equal(second.requests.length, 0);
  current.native.accept(job('cancel', 'failed', { nextCursor: 2 }), { owner: first.value });
  await current.dispose();
});

test('a confirmed native success wins a cancellation race and a stale pending poll cannot regress it', async () => {
  const poll = deferred();
  const polling = deferred();
  const host = client(path => {
    if (path === '/api/msbuild/jobs') return job('race');
    if (path.endsWith('/cancel')) return job('race', 'succeeded', { nextCursor: 3 });
    polling.resolve();
    return poll.promise;
  });
  const current = fixture(host.value);
  const pending = current.native.run();
  await polling.promise;
  current.tasks.cancel(current.tasks.running[0].id);
  await current.bridge.settled;
  poll.resolve(job('race', 'running', { nextCursor: 2 }));
  const result = await pending;
  assert.equal(result.status, 'succeeded');
  assert.equal(current.native.job.status, 'succeeded');
  assert.equal(current.context.state.nativeJob.status, 'succeeded');
  assert.equal(current.tasks.list()[0].status, 'completed');
  assert.equal(current.events.at(-1).selected, false);
  await current.dispose();
});

test('disposal coalesces TaskCenter cancellation before disconnect and abandons a pending poll without late UI writes', async () => {
  const poll = deferred();
  const polling = deferred();
  const cancel = deferred();
  const host = client(path => {
    if (path === '/api/msbuild/jobs') return job('dispose');
    if (path.endsWith('/cancel')) return cancel.promise;
    polling.resolve();
    return poll.promise;
  });
  const current = fixture(host.value);
  const pending = current.native.run();
  await polling.promise;
  current.bridge.dispose();
  const disposal = current.native.dispose();
  await Promise.resolve();
  assert.equal(host.value.token.length, 64, 'credentials remain available while captured cancellation is pending');
  assert.equal(host.requests.filter(request => request.path.endsWith('/cancel')).length, 1);
  assert(host.requests.every(request => request.authenticated));
  const count = current.events.length;
  cancel.resolve(job('dispose', 'cancelled', { nextCursor: 2 }));
  await Promise.all([disposal, current.bridge.settled]);
  assert.equal((await pending).status, 'cancelled');
  assert.equal(host.value.token, '');
  assert.equal(current.events.length, count);
  poll.resolve(job('dispose', 'succeeded', { nextCursor: 3 }));
  await Promise.resolve();
  assert.equal(current.events.length, count);
  assert.deepEqual(current.errors, []);
  await current.dispose();
});

test('disposal during job start waits for the actual returned ID, cancels it, and never publishes a post-disposal task', async () => {
  const start = deferred();
  const host = client(path => path === '/api/msbuild/jobs' ? start.promise : job('late-start', 'cancelled', { nextCursor: 2 }));
  const current = fixture(host.value);
  const pending = current.native.run();
  const disposal = current.native.dispose();
  assert.equal(host.value.token.length, 64);
  start.resolve(job('late-start'));
  await disposal;
  assert.equal((await pending).status, 'cancelled');
  assert.deepEqual(host.requests.map(request => request.path), ['/api/msbuild/jobs', '/api/msbuild/jobs/late-start/cancel']);
  assert(host.requests.every(request => request.authenticated));
  assert.equal(host.value.token, '');
  assert.equal(current.tasks.list().length, 0);
  assert.equal(current.events.length, 0);
  await current.dispose();
});
