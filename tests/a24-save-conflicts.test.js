import test from 'node:test';
import assert from 'node:assert/strict';
import {readProviderDirectory as readDirectory} from '@sharpforge/project-system';
import {FileSystemAccessProvider, WorkspaceSaveLocks, hashFileBytes} from '@sharpforge/workspace';
import {promptWorkspaceSaveConflict} from '../apps/studio/workspace-save-conflict.js';
import {memoryDirectory} from './support/memory-directory-handle.js';
import {workspaceApplication} from './support/workspace-application.js';

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

test('binary and externally deleted files retain explicit complete-version choices', async () => {
  const app = await fixture([['asset.bin', Uint8Array.of(0, 128, 255)]]);
  app.edit('asset.bin', Uint8Array.of(1, 2, 3));
  await app.provider.writeFile('asset.bin', Uint8Array.of(255, 0, 200));
  app.host.chooseSaveConflict = () => 'merge';
  await assert.rejects(app.session.save(), /Binary changes/);
  assert.deepEqual(app.state.extraFiles[0].bytes, Uint8Array.of(1, 2, 3));
  app.host.chooseSaveConflict = () => 'take-theirs';
  await app.session.save();
  assert.deepEqual(app.state.extraFiles[0].bytes, Uint8Array.of(255, 0, 200));
  app.edit('asset.bin', Uint8Array.of(5));
  await app.provider.delete('asset.bin');
  await app.session.save();
  assert.equal(app.host.context().records.length, 0);
  assert.equal(app.disk.records.length, 0);
  assert.equal(app.state.dirtyFiles.size, 0);
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

test('stale editor choices, overlapping edits and invalid limits fail without replacing either version', async () => {
  const app = await fixture([['A.cs', 'base']]);
  app.edit('A.cs', 'mine');
  await app.provider.writeFile('A.cs', bytes('theirs'));
  app.writes.length = 0;
  app.host.chooseSaveConflict = () => 'merge';
  await assert.rejects(app.session.save(), /overlap/);
  app.host.chooseSaveConflict = () => { app.edit('A.cs', 'newer mine'); return 'keep-mine'; };
  await assert.rejects(app.session.save(), /Editor changed/);
  assert.equal(app.state.files[0].text, 'newer mine');
  assert.deepEqual(app.writes, []);
  await assert.rejects(app.session.save({maxConflicts: 0}), /between 1 and 256/);
  await assert.rejects(app.session.save({maxConflicts: Infinity}), /between 1 and 256/);
  await assert.rejects(app.session.save({signal: AbortSignal.abort()}), {name: 'AbortError'});
});

test('edits made during a merged write remain dirty and require a new decision against the changed disk', async () => {
  let app;
  let saving = false;
  app = await fixture(undefined, () => { if (saving) { saving = false; app.edit('A.cs', 'newest\nsecond\nthird\n'); } });
  app.edit('A.cs', 'mine\nsecond\nthird\n');
  const originalBaseline = app.disk.baselineHashes.get('A.cs');
  await app.provider.writeFile('A.cs', bytes('first\nsecond\ntheirs\n'));
  app.host.chooseSaveConflict = () => 'merge';
  saving = true;
  const result = await app.session.save();
  assert.deepEqual(result.retained, ['A.cs']);
  assert.equal(app.state.files[0].text, 'newest\nsecond\nthird\n');
  assert.equal(text(await app.provider.readFile('A.cs')), 'mine\nsecond\ntheirs\n');
  assert.equal(app.disk.record('A.cs').text, 'mine\nsecond\ntheirs\n');
  assert.equal(app.disk.baselineHashes.get('A.cs'), originalBaseline);
  assert(app.state.dirtyFiles.has('A.cs'));
  let prompted = false;
  app.host.chooseSaveConflict = () => { prompted = true; return 'keep-mine'; };
  await app.session.save();
  assert.equal(prompted, true);
  assert.equal(app.state.dirtyFiles.size, 0);
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

test('save reentry, cancellation during a dialog and switched folder identity preserve current state', async () => {
  const app = await fixture([['A.cs', 'old']]);
  app.edit('A.cs', 'mine');
  await app.provider.writeFile('A.cs', bytes('external'));
  let answer;
  let announce;
  const waiting = new Promise(resolve => { announce = resolve; });
  app.host.chooseSaveConflict = () => new Promise(resolve => { answer = resolve; announce(); });
  const first = app.session.save();
  await waiting;
  await assert.rejects(app.session.save(), /already in progress/);
  answer(null);
  await first;
  const controller = new AbortController();
  app.host.chooseSaveConflict = () => { controller.abort(); return 'keep-mine'; };
  await assert.rejects(app.session.save({signal: controller.signal}), {name: 'AbortError'});
  app.host.persistenceReady = async () => { app.state.disk = {}; };
  await assert.rejects(app.session.save(), /Workspace changed/);
  assert.equal(app.state.saveBusy, false);
  assert.equal(text(await app.provider.readFile('A.cs')), 'external');
});

test('save prompt escapes file contents and describes unavailable text merges', () => {
  let html;
  const result = promptWorkspaceSaveConflict({ask: (title, body, action, read) => {
    assert.equal(title, 'Resolve Save Conflict');
    assert.equal(action, 'Apply Choice');
    html = body;
    return read();
  }, query: () => ({value: 'take-theirs'}), escapeHtml: value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')},
  {path: 'A.cs', base: undefined, mine: '</textarea><script>x</script>', theirs: Uint8Array.of(0, 255)});
  assert.equal(result, 'take-theirs');
  assert(!html.includes('<script>'));
  assert(html.includes('value="merge" disabled'));
  assert(html.includes('Binary file: 2 bytes'));
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
