import test from 'node:test';
import assert from 'node:assert/strict';
import {readProviderDirectory as readDirectory} from '@sharpforge/project-system';
import {FileSystemAccessProvider, WorkspaceSaveLocks, hashFileBytes} from '@sharpforge/workspace';
import {promptWorkspaceSaveConflict} from '../apps/studio/workspace-save-conflict.js';
import {memoryDirectory} from './support/memory-directory-handle.js';
import {workspaceApplication} from './support/workspace-save-host.js';

const bytes = text => new TextEncoder().encode(text);
const text = value => new TextDecoder().decode(value);

async function fixture(files = [['A.cs', 'first\nsecond\nthird\n']], beforeClose = () => {}) {
  const writes = [];
  const root = memoryDirectory({beforeClose: async (path, value) => { await beforeClose(path, value); writes.push(path); }});
  const provider = new FileSystemAccessProvider(root);
  for (const [path, value] of files) await provider.writeFile(path, typeof value === 'string' ? bytes(value) : value);
  const disk = await readDirectory(root, {provider});
  disk.saveLocks = new WorkspaceSaveLocks({identity: 'physical-root', locks: {request: (_name, _options, action) => action()}});
  const app = workspaceApplication();
  await app.session.load(disk.records, {disk, mode: 'folder'});
  writes.length = 0;
  return {...app, disk, provider, writes};
}

test('Save to Disk applies each explicit text resolution and advances exact physical baselines', async () => {
  for (const choice of ['keep-mine', 'take-theirs', 'merge']) {
    const app = await fixture();
    app.edit('A.cs', 'mine\nsecond\nthird\n');
    await app.provider.writeFile('A.cs', bytes('first\nsecond\ntheirs\n'));
    app.writes.length = 0;
    app.host.chooseSaveConflict = conflict => {
      assert.equal(conflict.base, 'first\nsecond\nthird\n');
      assert.equal(conflict.mine, 'mine\nsecond\nthird\n');
      assert.equal(conflict.theirs, 'first\nsecond\ntheirs\n');
      assert.equal(app.host.context().fileBusy, true);
      return choice;
    };
    const result = await app.session.save();
    const expected = choice === 'take-theirs' ? 'first\nsecond\ntheirs\n' : choice === 'merge' ? 'mine\nsecond\ntheirs\n'
      : 'mine\nsecond\nthird\n';
    assert.equal(app.state.files[0].text, expected);
    assert.equal(text(await app.provider.readFile('A.cs')), expected);
    assert.equal(app.disk.baselineHashes.get('A.cs'), await hashFileBytes(bytes(expected)));
    assert.deepEqual(app.writes, choice === 'take-theirs' ? [] : ['A.cs']);
    assert.deepEqual(result.adopted, choice === 'take-theirs' ? ['A.cs'] : []);
    assert.equal(app.state.dirtyFiles.size, 0);
    assert.equal(app.state.saveBusy, false);
  }
});

test('all choices precede any write and cancellation retains the complete pending batch', async () => {
  const app = await fixture([['A.cs', 'old A'], ['B.cs', 'old B']]);
  app.edit('A.cs', 'mine A');
  app.edit('B.cs', 'mine B');
  await app.provider.writeFile('B.cs', bytes('disk B'));
  app.writes.length = 0;
  app.host.chooseSaveConflict = () => null;
  assert.equal((await app.session.save()).cancelled, true);
  assert.deepEqual(app.writes, []);
  assert.equal(text(await app.provider.readFile('A.cs')), 'old A');
  assert.deepEqual([...app.state.dirtyFiles], ['A.cs', 'B.cs']);
  app.host.chooseSaveConflict = async () => {
    await app.provider.writeFile('B.cs', bytes('newer disk B'));
    app.writes.length = 0;
    return 'keep-mine';
  };
  await assert.rejects(app.session.save(), error => /changed after/.test(error.message) && error.written.length === 0);
  assert.deepEqual(app.writes, []);
  assert.equal(text(await app.provider.readFile('A.cs')), 'old A');
});

test('partial I/O receipts enumerate completed files and a retry clears only persisted current buffers', async () => {
  let failing = false;
  const app = await fixture([['A.cs', 'old'], ['B.cs', 'old'], ['C.cs', 'old']], path => {
    if (failing && path === 'C.cs') throw new Error('Injected close failure');
  });
  for (const path of ['A.cs', 'B.cs', 'C.cs']) app.edit(path, path);
  failing = true;
  await assert.rejects(app.session.save(), error => {
    assert.deepEqual(error.written, ['A.cs', 'B.cs']);
    assert.equal(error.hashes.length, 2);
    return /Injected close failure/.test(error.message);
  });
  assert.equal(text(await app.provider.readFile('C.cs')), 'old');
  assert.equal(app.state.files.find(file => file.uri === 'C.cs').text, 'C.cs');
  failing = false;
  assert.deepEqual((await app.session.save()).written, ['C.cs']);
  assert.equal(app.state.dirtyFiles.size, 0);
});

test('identity is checked across persistence setup even when the physical disk object is reused', async () => {
  const app = await fixture([['A.cs', 'old']]);
  app.edit('A.cs', 'reviewed');
  app.host.persistenceReady = async () => {
    app.state.workspaceEpoch++;
    app.state.files = [{uri: 'Other.cs', text: 'another workspace', version: 1}];
  };
  await assert.rejects(app.session.save(), /Workspace changed/);
  assert.deepEqual(app.writes, []);
  assert.equal(text(await app.provider.readFile('A.cs')), 'old');
});

test('an editor version changed during asynchronous dirty hashing is re-read before dirty state is cleared', async () => {
  const app = await fixture([['A.cs', 'old']]);
  app.edit('A.cs', 'reviewed');
  const originalContext = app.host.context;
  let inject = true;
  app.host.context = () => {
    const snapshot = originalContext();
    if (inject && app.writes.includes('A.cs')) {
      inject = false;
      queueMicrotask(() => {
        const file = app.state.files[0];
        file.text = 'newest';
        file.version++;
      });
    }
    return snapshot;
  };
  await assert.rejects(app.session.save(), /buffers changed/);
  assert.equal(app.state.files[0].text, 'newest');
  assert(app.state.dirtyFiles.has('A.cs'));
  assert.equal(text(await app.provider.readFile('A.cs')), 'reviewed');
});
