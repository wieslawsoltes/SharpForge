import test from 'node:test';
import assert from 'node:assert/strict';
import {RecentWorkspaceHandles} from '@sharpforge/workspace';
import {handleDatabase, registryLocks, directoryHandle} from './support/a24-handle-database.js';

function registry(database = handleDatabase(), options = {}) {
  return new RecentWorkspaceHandles({indexedDB: database.indexedDB, ...options});
}

test('physical identities survive recent-menu eviction and simultaneous reopen across windows', async () => {
  const database = handleDatabase();
  const first = registry(database);
  const second = registry(database);
  const locks = registryLocks();
  let generated = 0;
  const options = {locks, createId: () => String(++generated)};
  const identities = await Promise.all([
    first.identify(directoryHandle('original'), options), second.identify(directoryHandle('original'), options)
  ]);
  assert.equal(identities[0], identities[1]);
  for (let index = 0; index < 21; index++) await first.identify(directoryHandle('other-' + index), options);
  assert.equal((await first.list()).length, 20);
  assert(!(await first.list()).some(record => record.identity === identities[0]));
  assert.equal(await second.identify(directoryHandle('original'), options), identities[0]);
  assert.equal(generated, 22, 'recent eviction cannot allocate a second physical lock identity');
  assert.equal(database.state.stores.get('identities').size, 22);
  first.dispose();
  second.dispose();
});

test('identity registry capacity is explicit and existing folders remain reusable at capacity', async () => {
  const database = handleDatabase();
  const value = registry(database, {maxEntries: 1, maxIdentityEntries: 2});
  const locks = registryLocks();
  let next = 0;
  const options = {locks, createId: () => String(++next)};
  const original = await value.identify(directoryHandle('one'), options);
  await value.identify(directoryHandle('two'), options);
  await value.forget(original);
  await assert.rejects(value.identify(directoryHandle('three'), options), /SFW1326.*capacity/);
  assert.equal(await value.identify(directoryHandle('one'), options), original);
  assert.equal(database.state.stores.get('identities').size, 2);
  value.dispose();
});

test('version-one recent handles migrate without replacing an existing physical identity', async () => {
  const old = {identity: 'directory:old-key', handle: directoryHandle('old'), sequence: 7, name: 'Old', openDocuments: []};
  const database = handleDatabase({version: 1, workspaces: [old]});
  const value = registry(database);
  const identity = await value.identify(directoryHandle('old'), {locks: registryLocks(), createId: () => 'unexpected'});
  assert.equal(identity, old.identity);
  assert.equal(database.state.version, 2);
  assert.equal(database.state.stores.get('identities').get(old.identity).handle.key, 'old');
  value.dispose();
});

for (const action of ['abort', 'dispose']) {
  test('identity comparison rechecks ' + action + ' before returning or registering a physical key', async () => {
    const database = handleDatabase();
    const value = registry(database);
    const options = {locks: registryLocks(), createId: () => 'stable'};
    await value.identify(directoryHandle('same'), options);
    let entered;
    let release;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const delayed = directoryHandle('same', async other => { entered(); await gate; return other.key === 'same'; });
    const controller = new AbortController();
    const pending = value.identify(delayed, {...options, signal: controller.signal});
    const rejected = assert.rejects(pending, error => action === 'abort' ? error.name === 'AbortError' : /disposed/i.test(error.message));
    await started;
    if (action === 'abort') controller.abort();
    else value.dispose();
    release();
    await rejected;
    assert.equal(database.state.stores.get('identities').size, 1);
    value.dispose();
  });
}

test('identity errors reject unavailable coordination, ambiguous handles and duplicate generated keys', async () => {
  const value = registry();
  await assert.rejects(value.identify(directoryHandle('one'), {locks: null}), /Web Locks/);
  await assert.rejects(value.identify({kind: 'directory', name: 'Name'}, {locks: registryLocks()}), /comparable/);
  const options = {locks: registryLocks(), createId: () => 'repeated'};
  await value.identify(directoryHandle('one'), options);
  await assert.rejects(value.identify(directoryHandle('two'), options), /SFW1327.*unique/);
  assert.equal(await value.identify(directoryHandle('one'), options), 'directory:repeated');
  value.dispose();
  await assert.rejects(value.identify(directoryHandle('one'), options), /disposed/i);
});
