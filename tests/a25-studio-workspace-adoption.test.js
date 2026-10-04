import test from 'node:test';
import assert from 'node:assert/strict';
import { adoptGitWorkspace } from '../apps/studio/git-workspace-adoption.js';
import { beginGitWorkspaceLoad, withGitWorkspaceLoad } from '../apps/studio/git-workspace-load.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const outcome = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));

async function reach(marker, completion) {
  await Promise.race([marker.promise, completion.then(result => {
    assert.fail(`Adoption finished before the expected boundary: ${result.ok ? 'success' : String(result.error)}`);
  })]);
}

function fixture({ bound = true } = {}) {
  const original = [{ path: 'original.cs', text: 'old source' }];
  const records = [{ path: 'adopted.cs', text: 'new source' }];
  const state = { files: original, revision: 3, diskRevision: 4, workspaceEpoch: 5, nativeMode: false, readOnly: false };
  let identity = 'workspace:original';
  const identityFailure = { enabled: false, value: undefined };
  const publications = [];
  const workbench = { repositoryId: 'original-repository', workspaceBound: bound, workspaceIdentity: identity };
  const host = {
    getState: () => state,
    getWorkspaceIdentity() {
      if (identityFailure.enabled) throw identityFailure.value;
      return identity;
    },
    adoptRecords: async () => { throw new Error('The test must provide its source adoption transaction'); }
  };
  workbench.host = host;
  const replaceSource = (next = records, nextIdentity = 'workspace:adopted') => {
    state.files = next;
    state.revision++;
    state.diskRevision++;
    state.workspaceEpoch++;
    identity = nextIdentity;
  };
  const commit = (options, next = records, nextIdentity = 'workspace:adopted') => {
    options.validate();
    replaceSource(next, nextIdentity);
    options.onCommitted();
  };
  const publish = (repositoryId = 'adopted-repository') => {
    workbench.repositoryId = repositoryId;
    workbench.workspaceIdentity = host.getWorkspaceIdentity();
    workbench.workspaceBound = true;
    publications.push({ repositoryId, identity: workbench.workspaceIdentity, files: state.files });
  };
  const run = (next = records, repositoryId = 'adopted-repository') => withGitWorkspaceLoad(host, {}, options =>
    adoptGitWorkspace(workbench, next, options, { openWorkspace: true, name: 'Adopted' }, () => publish(repositoryId)));
  return { host, workbench, state, original, records, publications, identityFailure, replaceSource, commit, run };
}

test('repository selection remains provisional until the owning commit and binds before asynchronous finish', async () => {
  const f = fixture();
  const prepare = deferred();
  const committed = deferred();
  const finish = deferred();
  const result = { committed: true, loaded: 'Adopted' };
  let completionObserved = false;
  f.host.adoptRecords = async (records, options) => {
    assert.equal(f.workbench.repositoryId, 'original-repository');
    assert.equal(f.workbench.workspaceBound, false);
    assert.equal(f.state.files, f.original);
    assert.equal(options.openWorkspace, true);
    assert.equal(options.name, 'Adopted');
    await prepare.promise;
    f.commit(options, records);
    assert.equal(f.workbench.repositoryId, 'adopted-repository');
    assert.equal(f.workbench.workspaceBound, true);
    assert.equal(f.workbench.workspaceIdentity, 'workspace:adopted');
    committed.resolve();
    await finish.promise;
    return result;
  };
  const completion = outcome(f.run()).then(value => { completionObserved = true; return value; });
  assert.equal(f.workbench.repositoryId, 'original-repository');
  assert.equal(f.publications.length, 0);
  prepare.resolve();
  await reach(committed, completion);
  assert.equal(completionObserved, false);
  assert.equal(f.publications.length, 1);
  assert.equal(f.publications[0].files, f.records);
  assert.equal(f.state.revision, 4);
  finish.resolve();
  assert.deepEqual(await completion, { ok: true, value: result });
  assert.equal(f.workbench.workspaceBound, true);
});

test('valid null and false declines restore exactly the previous binding without selecting the prepared repository', async () => {
  for (const bound of [true, false]) for (const declined of [null, false]) {
    const f = fixture({ bound });
    f.host.adoptRecords = async (_records, options) => { options.validate(); return declined; };
    const result = await outcome(f.run());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'Cancelled');
    assert.equal(f.workbench.workspaceBound, bound);
    assert.equal(f.workbench.repositoryId, 'original-repository');
    assert.equal(f.workbench.workspaceIdentity, 'workspace:original');
    assert.equal(f.state.files, f.original);
    assert.deepEqual(f.publications, []);
  }
});

test('precommit failures including falsy thrown values preserve identity and restore a still-valid old binding', async () => {
  const failure = new Error('Source preparation failed');
  for (const value of [failure, undefined, null, false, 0, '', NaN, 0n]) {
    const f = fixture();
    f.host.adoptRecords = async () => { throw value; };
    const result = await outcome(f.run());
    assert.equal(result.ok, false);
    assert.ok(Object.is(result.error, value));
    assert.equal(f.workbench.workspaceBound, true);
    assert.equal(f.workbench.repositoryId, 'original-repository');
    assert.equal(f.state.files, f.original);
    assert.deepEqual(f.publications, []);
  }
});

test('stale precommit source or repository selection cannot restore the previous binding', async () => {
  for (const change of ['source', 'repository']) {
    const f = fixture();
    f.host.adoptRecords = async (_records, options) => {
      if (change === 'source') f.replaceSource([{ path: 'other.cs', text: 'unrelated workspace' }], 'workspace:other');
      else f.workbench.repositoryId = 'selected-elsewhere';
      options.validate();
      assert.fail('A stale adoption must fail before its source transaction');
    };
    const result = await outcome(f.run());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'Conflict');
    assert.equal(f.workbench.workspaceBound, false);
    assert.equal(f.workbench.repositoryId, change === 'source' ? 'original-repository' : 'selected-elsewhere');
    assert.deepEqual(f.publications, []);
  }
});

test('a host committed error retains its exact identity and the binding captured at its callback', async () => {
  const f = fixture();
  const failure = Object.assign(new Error('Post-commit build failed'), { committed: true, code: 'DOCUMENT_COMMITTED' });
  f.host.adoptRecords = async (records, options) => { f.commit(options, records); throw failure; };
  const result = await outcome(f.run());
  assert.equal(result.ok, false);
  assert.equal(result.error, failure);
  assert.equal(f.workbench.repositoryId, 'adopted-repository');
  assert.equal(f.workbench.workspaceIdentity, 'workspace:adopted');
  assert.equal(f.workbench.workspaceBound, true);
  assert.equal(f.state.files, f.records);
  assert.equal(f.publications.length, 1);
});

test('an ordinary or falsy failure after the callback remains an explicit committed failure', async () => {
  for (const failure of [new Error('Finish failed'), undefined, false]) {
    const f = fixture();
    f.host.adoptRecords = async (records, options) => { f.commit(options, records); throw failure; };
    const result = await outcome(f.run());
    assert.equal(result.ok, false);
    assert.equal(result.error.committed, true);
    assert.ok(result.error instanceof AggregateError);
    assert.equal(result.error.errors.length, 1);
    assert.equal(result.error.errors[0], failure);
    assert.equal(f.workbench.workspaceBound, true);
    assert.equal(f.workbench.workspaceIdentity, 'workspace:adopted');
  }
});

test('a workspace replaced during asynchronous postcommit finish leaves the adopted repository unbound', async () => {
  const f = fixture();
  const committed = deferred();
  const finish = deferred();
  f.host.adoptRecords = async (records, options) => {
    f.commit(options, records);
    committed.resolve();
    await finish.promise;
    return { committed: true };
  };
  const completion = outcome(f.run());
  await reach(committed, completion);
  f.replaceSource([{ path: 'unrelated.cs', text: 'another workspace' }], 'workspace:other');
  finish.resolve();
  const result = await completion;
  assert.equal(result.ok, false);
  assert.equal(result.error.committed, true);
  assert.equal(result.error.errors[0].code, 'Conflict');
  assert.equal(f.workbench.workspaceBound, false);
  assert.equal(f.workbench.workspaceIdentity, 'workspace:adopted');
  assert.equal(f.host.getWorkspaceIdentity(), 'workspace:other');
  assert.equal(f.publications.length, 1);
});

test('a newer load ticket cancels postcommit completion without revalidating the old document revision', async () => {
  const f = fixture();
  const committed = deferred();
  const finish = deferred();
  f.host.adoptRecords = async (records, options) => {
    f.commit(options, records);
    committed.resolve();
    await finish.promise;
    return { committed: true };
  };
  const completion = outcome(f.run());
  await reach(committed, completion);
  const newer = beginGitWorkspaceLoad(f.host);
  try {
    finish.resolve();
    const result = await completion;
    assert.equal(result.ok, false);
    assert.equal(result.error.committed, true);
    assert.equal(result.error.errors[0].code, 'Cancelled');
    assert.equal(f.workbench.workspaceBound, false);
    assert.equal(f.workbench.workspaceIdentity, 'workspace:adopted');
    newer.check();
  } finally { newer.finish(); }
});

test('an older completion cannot retire the binding installed by a newer committed adoption', async () => {
  const f = fixture();
  const firstCommitted = deferred();
  const firstFinish = deferred();
  const secondRecords = [{ path: 'second.cs', text: 'second repository' }];
  f.host.adoptRecords = async (records, options) => {
    if (records === f.records) {
      f.commit(options, records);
      firstCommitted.resolve();
      await firstFinish.promise;
    } else f.commit(options, records, 'workspace:second');
    return { committed: true };
  };
  const first = outcome(f.run());
  await reach(firstCommitted, first);
  const second = await outcome(f.run(secondRecords, 'second-repository'));
  assert.equal(second.ok, true);
  firstFinish.resolve();
  const result = await first;
  assert.equal(result.ok, false);
  assert.equal(result.error.committed, true);
  assert.equal(f.workbench.repositoryId, 'second-repository');
  assert.equal(f.workbench.workspaceIdentity, 'workspace:second');
  assert.equal(f.workbench.workspaceBound, true);
  assert.equal(f.state.files, secondRecords);
  assert.equal(f.publications.length, 2);
});

test('a stale callback cannot overwrite a newer receipt or clear its binding', async () => {
  const f = fixture();
  const firstReady = deferred();
  const delayedCallback = deferred();
  const secondCommitted = deferred();
  const secondFinish = deferred();
  const secondRecords = [{ path: 'second.cs', text: 'second repository' }];
  f.host.adoptRecords = async (records, options) => {
    if (records === f.records) {
      firstReady.resolve();
      await delayedCallback.promise;
      // A late host callback violates the synchronous contract but must not corrupt the current owner.
      options.onCommitted();
    } else {
      f.commit(options, records, 'workspace:second');
      secondCommitted.resolve();
      await secondFinish.promise;
    }
    return { committed: true };
  };
  const first = outcome(f.run());
  await reach(firstReady, first);
  const second = outcome(f.run(secondRecords, 'second-repository'));
  await reach(secondCommitted, second);
  delayedCallback.resolve();
  const stale = await first;
  assert.equal(stale.ok, false);
  assert.equal(stale.error.committed, true);
  assert.equal(f.workbench.repositoryId, 'second-repository');
  assert.equal(f.workbench.workspaceIdentity, 'workspace:second');
  assert.equal(f.workbench.workspaceBound, true);
  assert.equal(f.publications.length, 1);
  secondFinish.resolve();
  assert.equal((await second).ok, true);
  assert.equal(f.workbench.workspaceBound, true);
});

test('successful source adoption without its callback reports an explicit committed and unbound failure', async () => {
  const f = fixture();
  f.host.adoptRecords = async (records, options) => {
    options.validate();
    f.replaceSource(records);
    return { committed: true };
  };
  const result = await outcome(f.run());
  assert.equal(result.ok, false);
  assert.equal(result.error.committed, true);
  assert.ok(result.error instanceof AggregateError);
  assert.equal(result.error.errors[0].code, 'Unsupported');
  assert.equal(f.workbench.workspaceBound, false);
  assert.equal(f.workbench.repositoryId, 'original-repository');
  assert.equal(f.state.files, f.records);
  assert.deepEqual(f.publications, []);
});

test('falsy completion identity failures cannot become successful adoptions', async () => {
  for (const failure of [undefined, false]) {
    const f = fixture();
    f.host.adoptRecords = async (records, options) => {
      f.commit(options, records);
      f.identityFailure.enabled = true;
      f.identityFailure.value = failure;
      return { committed: true };
    };
    const result = await outcome(f.run());
    assert.equal(result.ok, false);
    assert.equal(result.error.committed, true);
    assert.equal(result.error.errors.length, 1);
    assert.equal(result.error.errors[0], failure);
    assert.equal(f.workbench.workspaceBound, false);
    assert.equal(f.workbench.workspaceIdentity, 'workspace:adopted');
  }
});

test('a committed primary error and undefined completion error both survive in the failure evidence', async () => {
  const f = fixture();
  const primary = Object.assign(new Error('Build failed after commit'), { committed: true });
  f.host.adoptRecords = async (records, options) => {
    f.commit(options, records);
    f.identityFailure.enabled = true;
    f.identityFailure.value = undefined;
    throw primary;
  };
  const result = await outcome(f.run());
  assert.equal(result.ok, false);
  assert.equal(result.error.committed, true);
  assert.equal(result.error.errors.length, 2);
  assert.equal(result.error.errors[0], primary);
  assert.equal(result.error.errors[1], undefined);
  assert.equal(f.workbench.workspaceBound, false);
  assert.equal(f.state.files, f.records);
});
