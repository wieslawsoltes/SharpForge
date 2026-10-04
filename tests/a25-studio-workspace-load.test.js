import test from 'node:test';
import assert from 'node:assert/strict';
import { GitError } from '@sharpforge/git';
import { beginGitWorkspaceLoad, withGitWorkspaceLoad, checkGitWorkspaceLoad,
  checkGitWorkspaceLoadOwnership, cancelGitWorkspaceLoad } from '../apps/studio/git-workspace-load.js';
import { cloneGitRepository } from '../apps/studio/git-clone-dialog.js';
import { commitStudioWorkspaceAfterStop, commitStudioWorkspaceRecords } from '../apps/studio/services/workspace-records.js';
import { deferred, temporaryGlobal, workspaceFixture } from './git-workspace/fixture.js';

test('A25 workspace capture detects identity, source revision and mode changes without reading source content', async () => {
  for (const field of ['revision', 'diskRevision', 'workspaceEpoch', 'nativeMode', 'readOnly', 'files', 'identity']) {
    const fixture = workspaceFixture();
    Object.defineProperty(fixture.state.files[0], 'text', { get() { throw new Error('Source text must not be flattened'); } });
    const ticket = beginGitWorkspaceLoad(fixture.host);
    if (field === 'identity') fixture.identity = 'other-workspace';
    else if (field === 'files') fixture.state.files = [];
    else fixture.state[field] = field === 'readOnly' || field === 'nativeMode' ? true : 2;
    assert.throws(() => ticket.check(), { code: 'Conflict' });
    ticket.finish();
  }
});

test('A25 nested loads preserve the exact native ticket and finish once after their own committed revision advances', async () => {
  const fixture = workspaceFixture({ native: true });
  await withGitWorkspaceLoad(fixture.host, {}, async outer => {
    await withGitWorkspaceLoad(fixture.host, outer, async inner => {
      assert.equal(inner.workspaceLoad, outer.workspaceLoad);
      assert.equal(inner.signal, fixture.nativeTickets[0].signal);
      assert.equal(fixture.nativeTickets.length, 1);
      fixture.state.revision++;
      assert.doesNotThrow(() => checkGitWorkspaceLoadOwnership(inner));
      assert.throws(() => checkGitWorkspaceLoad(inner), { code: 'Conflict' });
    });
  });
  assert.equal(fixture.nativeTickets[0].finishes, 1);
});

test('A25 tickets reject cross-host reuse, supersession and cancellation, including cancellation while a picker is pending', async () => {
  const fixture = workspaceFixture({ native: true });
  const first = beginGitWorkspaceLoad(fixture.host);
  const second = beginGitWorkspaceLoad(fixture.host);
  assert.equal(first.signal.aborted, true);
  assert.throws(() => first.check(), { code: 'Cancelled' });
  const other = workspaceFixture();
  await assert.rejects(withGitWorkspaceLoad(other.host, { workspaceLoad: second }, () => {}), { code: 'Conflict' });
  cancelGitWorkspaceLoad(fixture.host);
  assert.equal(second.signal.aborted, true);
  assert.equal(fixture.nativeTickets[1].finishes, 1);
  first.finish();
  assert.equal(fixture.nativeTickets[0].finishes, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(withGitWorkspaceLoad(other.host, { signal: controller.signal }, () => {
    throw new Error('A cancelled action must not run');
  }), { code: 'Cancelled' });
});

test('A25 load cleanup retains falsy action failures and committed error identity', async () => {
  for (const cause of [false, 0, null, undefined]) {
    const fixture = workspaceFixture({ native: true });
    fixture.finishError = new Error('Native ticket cleanup failed');
    await assert.rejects(withGitWorkspaceLoad(fixture.host, {}, () => { throw cause; }), error => {
      assert(error instanceof AggregateError);
      assert.deepEqual(error.errors, [cause, fixture.finishError]);
      return true;
    });
  }
  const fixture = workspaceFixture({ native: true });
  const committed = Object.assign(new Error('Committed native cleanup failure'), { committed: true });
  await assert.rejects(withGitWorkspaceLoad(fixture.host, {}, () => { throw committed; }), error => error === committed);
  fixture.finishError = new Error('Additional cleanup failure');
  await assert.rejects(withGitWorkspaceLoad(fixture.host, {}, () => { throw committed; }), error => {
    assert.equal(error.committed, true);
    assert.deepEqual(error.errors, [committed, fixture.finishError]);
    return true;
  });
});

test('A25 run captures the workspace before awaiting worker readiness', async t => {
  temporaryGlobal(t, 'document', { querySelectorAll: () => [] });
  const fixture = workspaceFixture({ native: true });
  const ready = deferred();
  fixture.workbench.ready = ready.promise;
  let called = false;
  const result = fixture.workbench.run(() => { called = true; }, { workspace: true });
  assert.equal(fixture.nativeTickets.length, 1);
  assert.equal(fixture.workbench.busy, true);
  fixture.edit('class Intervening {}\n');
  const rejected = assert.rejects(result, { code: 'Conflict' });
  ready.resolve();
  await rejected;
  assert.equal(called, false);
  assert.equal(fixture.workbench.busy, false);
  assert.equal(fixture.nativeTickets[0].finishes, 1);
});

test('A25 open directory captures before its native picker and rejects changed workspaces without opening a repository', async t => {
  temporaryGlobal(t, 'document', { querySelectorAll: () => [] });
  const fixture = workspaceFixture({ native: true });
  const picker = deferred();
  temporaryGlobal(t, 'window', { showDirectoryPicker() {
    assert.equal(fixture.nativeTickets.length, 1);
    return picker.promise;
  } });
  const result = fixture.workbench.openDirectory();
  fixture.edit('class EditedDuringPicker {}\n');
  const rejected = assert.rejects(result, { code: 'Conflict' });
  picker.resolve({ kind: 'directory', name: 'Prepared' });
  await rejected;
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.workbench.repositoryId, 'original');
  assert.equal(fixture.nativeTickets[0].finishes, 1);
});

const cloneValues = { url: 'https://github.com/fixture/repository.git', branch: '', depth: '0', filter: '',
  provider: 'github', authentication: 'anonymous', algorithm: 'sha1' };

test('A25 clone shares one ticket through RPC and adoption and publishes its staged repository only at source commit', async t => {
  temporaryGlobal(t, 'document', { querySelectorAll: () => [] });
  const fixture = workspaceFixture({ native: true });
  fixture.onRequest = method => {
    if (['init', 'clone', 'files'].includes(method)) assert.equal(fixture.workbench.repositoryId, 'original');
  };
  const adopt = fixture.host.adoptRecords;
  fixture.host.adoptRecords = async (records, options) => {
    assert.equal(fixture.workbench.repositoryId, 'original');
    assert.equal(fixture.workbench.workspaceBound, false);
    assert.equal(options.load, fixture.nativeTickets[0]);
    return adopt(records, options);
  };
  await cloneGitRepository(fixture.workbench, cloneValues);
  const repositoryId = fixture.calls.find(call => call.method === 'init').params.repositoryId;
  assert.equal(fixture.workbench.repositoryId, repositoryId);
  assert.equal(fixture.workbench.workspaceBound, true);
  assert.equal(fixture.workbench.workspaceIdentity, fixture.identity);
  assert.equal(fixture.nativeTickets.length, 1);
  assert.equal(fixture.nativeTickets[0].finishes, 1);
  assert(fixture.calls.every(call => !Object.hasOwn(call.options, 'workspaceLoad')));
  assert.equal(fixture.workbench.synced.has('Prepared.cs'), true);
});

test('A25 rejected clone adoption leaves the prepared repository staged and can synchronize only the original repository', async t => {
  temporaryGlobal(t, 'document', { querySelectorAll: () => [] });
  const fixture = workspaceFixture();
  const entered = deferred();
  const reading = deferred();
  fixture.onRequest = async method => {
    if (method === 'files') { entered.resolve(); await reading.promise; }
  };
  const result = cloneGitRepository(fixture.workbench, cloneValues);
  await entered.promise;
  fixture.edit('class UserEdit {}\n');
  const rejected = assert.rejects(result, { code: 'Conflict' });
  reading.resolve();
  await rejected;
  const prepared = fixture.calls.find(call => call.method === 'init').params.repositoryId;
  assert.equal(fixture.workbench.repositories.has(prepared), true);
  assert.equal(fixture.workbench.repositoryId, 'original');
  assert.equal(fixture.adoptions.length, 0);
  await fixture.workbench.synchronize();
  assert.deepEqual(fixture.calls.filter(call => call.method === 'syncFiles').map(call => call.params.repositoryId), ['original']);
});

test('A25 legacy shutdown rechecks changes and commits in the same continuation as its final validation', async () => {
  const stop = deferred();
  const controller = new AbortController();
  let commits = 0;
  const pending = commitStudioWorkspaceAfterStop(() => stop.promise, { signal: controller.signal }, () => { commits++; });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  stop.resolve();
  controller.abort();
  await rejected;
  assert.equal(commits, 0);
  const order = [];
  let checks = 0;
  await commitStudioWorkspaceAfterStop(async () => {}, { validate() {
    if (++checks === 2) queueMicrotask(() => order.push('later microtask'));
  } }, () => order.push('source commit'));
  assert.deepEqual(order, ['source commit', 'later microtask']);
});

test('A25 legacy record transaction checks before disposing editors and reports commit before host effects', async () => {
  const fixture = workspaceFixture();
  const events = [];
  const state = Object.assign(fixture.state, { extraFiles: [], folders: [], workspaceMode: 'folder', tabs: ['Original.cs'],
    active: 'Original.cs', breakpoints: {} });
  const host = { state, editors: new Map([['Original.cs', { dispose() { events.push('dispose'); } }]]),
    documentEvents: { publish() {} }, renderWorkspace() { events.push('render'); }, saveLocal() {}, scheduleAnalysis() {} };
  const oldFiles = state.files;
  const conflict = new GitError('Conflict', 'Workspace changed during preparation');
  await assert.rejects(commitStudioWorkspaceRecords(host, { records: [{ path: 'Prepared.cs', text: 'class Prepared {}' }],
    validate() { throw conflict; } }), error => error === conflict);
  assert.equal(state.files, oldFiles);
  assert.deepEqual(events, []);
  await commitStudioWorkspaceRecords(host, { records: [{ path: 'Prepared.cs', text: 'class Prepared {}' }],
    onCommitted() { assert.equal(state.files[0].uri, 'Prepared.cs'); events.push('committed'); } });
  assert.deepEqual(events, ['dispose', 'committed', 'render']);
});
