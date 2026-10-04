import test from 'node:test';
import assert from 'node:assert/strict';
import { GitWorkbench } from '../apps/studio/git-workbench.js';
import { renderGitMerge } from '../apps/studio/git-merge-editor.js';
import { viewFixture, conflictStages } from './a25-ui-data-fixtures.js';
import { toolsDocument } from './git-tools/dom.js';

function mergeElement() {
  const document = toolsDocument();
  const element = document.createElement('div');
  element.isConnected = true;
  element.hidden = true;
  element.classList = { add() {} };
  document.body.append(element);
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  return { document, element };
}

test('a hidden mounted merge view retires after real index resolution and later workbench refreshes', async t => {
  const { repo, run } = await viewFixture(t);
  const path = 'image.dat';
  await conflictStages(repo, path, { base: new Uint8Array([0, 1]),
    ours: new Uint8Array([0, 2]), theirs: new Uint8Array([0, 3]) });
  const { document, element } = mergeElement();
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: document });
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  });
  const toasts = [];
  const requests = [];
  let detail;
  const workbench = Object.assign(Object.create(GitWorkbench.prototype), {
    repositoryId: 'ui', selection: { path }, changes: await repo.status(),
    mounts: new Map(), closed: false, busy: false, ready: Promise.resolve(),
    host: { toast: message => toasts.push(message) }, updateStatus() {},
    async request(method, params, options) {
      requests.push({ method, signal: options.signal });
      const result = await run(method, params, options);
      if (method === 'conflictDetail') detail = result;
      return result;
    },
    async refresh() { this.changes = await repo.status(); }
  });
  const state = { gitMounted: true };
  await workbench.render('git-merge', element, state);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'conflictDetail');
  assert.equal(requests[0].signal.aborted, false);
  assert.match(element.textContent, /Accept Incoming/u);

  await workbench.run(() => run('resolveConflictChoice', {
    path, choice: 'theirs', stagesKey: detail.stagesKey, workingOid: detail.working.oid
  }));
  assert.equal(repo.index.unmerged.length, 0);
  assert.deepEqual((await repo.worktree.read(path)).data, new Uint8Array([0, 3]));
  assert.equal(requests[0].signal.aborted, true, 'Rerender must dispose the previous conflict request lifetime');
  assert.match(element.textContent, /No unresolved conflict/u);
  assert.deepEqual(toasts, []);
  assert.equal(requests.length, 1, 'Resolved paths must not request conflict details again');

  await workbench.run(async () => {});
  workbench.selection = { path: 'history.txt', commit: 'historical-selection' };
  await workbench.renderMounted();
  assert.equal(requests.length, 1, 'Later refresh or historical selection must not revive the resolved conflict view');
  assert.deepEqual(toasts, []);
  assert.match(element.textContent, /No unresolved conflict/u);
});

test('merge view requires the selected path itself to have unresolved stages', async () => {
  const { element } = mergeElement();
  let requests = 0;
  const workbench = {
    selection: { path: 'ordinary.txt' },
    changes: [{ path: 'ordinary.txt', staged: true, conflict: false }, { path: 'other.txt', conflict: true }],
    request() { requests++; throw new Error('A non-conflicted path must not read conflict details'); }
  };
  await renderGitMerge(element, workbench);
  assert.equal(requests, 0);
  assert.match(element.textContent, /No unresolved conflict/u);
  workbench.selection = null;
  await renderGitMerge(element, workbench);
  assert.equal(requests, 0);
  assert.match(element.textContent, /Choose a conflicted file/u);
});

test('current conflict-detail failures remain strict when the status still advertises a conflict', async t => {
  const { run } = await viewFixture(t);
  const { element } = mergeElement();
  let signal;
  const workbench = {
    selection: { path: 'stale.txt' }, changes: [{ path: 'stale.txt', conflict: true }],
    request(method, params, options) {
      signal = options.signal;
      return run(method, params, options);
    }
  };
  await assert.rejects(renderGitMerge(element, workbench), error =>
    error.code === 'NotFound' && error.message === 'Path has no unresolved index stages');
  assert.ok(signal instanceof AbortSignal);
  assert.doesNotMatch(element.textContent, /No unresolved conflict/u);
});
