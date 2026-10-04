import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceTransactionJournal, ProviderTransactionAdapter, FileOperationHistory, WorkspaceSaveLocks,
  FileSystemAccessProvider} from '@sharpforge/workspace';
import {ProviderDiskWorkspace as DiskWorkspace} from '@sharpforge/project-system';
import {decodeWorkspaceFile} from '@sharpforge/archive';
import {memoryDirectory} from './support/memory-directory-handle.js';

function serialLocks() {
  const tails = new Map();
  return {request(name, options, action) {
    const next = (tails.get(name) ?? Promise.resolve()).then(() => { options.signal?.throwIfAborted(); return action(); });
    tails.set(name, next.then(() => {}, () => {}));
    return next;
  }};
}

async function session({files = [['Src/A.cs', 'old'], ['untouched.cs', 'saved']], folders = ['Src'], beforeClose} = {}) {
  const root = memoryDirectory({beforeClose});
  const provider = new FileSystemAccessProvider(root);
  for (const folder of folders) await provider.createDirectory(folder, {recursive: true});
  const records = [];
  for (const [path, content] of files) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    await provider.writeFile(path, bytes);
    records.push(decodeWorkspaceFile(path, bytes));
  }
  const disk = new DiskWorkspace(records.map(record => ({...record})), new Map(), 'Physical', folders,
    [], {rootHandle: root, provider, saveLocks: new WorkspaceSaveLocks({identity: 'directory:test', locks: serialLocks()})});
  await disk.initializeBaselines();
  let state = {records: records.map(record => ({...record})), folders: [...folders], active: 'Src/A.cs',
    tabs: ['Src/A.cs', 'untouched.cs'], dirty: ['Src/A.cs', 'untouched.cs'], breakpoints: {'Src/A.cs': [1]}};
  const adapter = new ProviderTransactionAdapter({getWorkspace: () => disk});
  const journal = new WorkspaceTransactionJournal({getState: () => state, commitState: value => { state = value; }, adapter});
  const history = new FileOperationHistory(journal);
  return {provider, disk, journal, history, get state() { return state; }};
}

test('provider journal persists directory rename and undo while preserving unrelated unsaved buffers', async () => {
  const value = await session();
  value.state.records.find(record => record.path === 'Src/A.cs').text = 'edited';
  value.state.records.find(record => record.path === 'untouched.cs').text = 'unsaved elsewhere';
  const receipt = await value.history.execute([{kind: 'move', path: 'Src', destination: 'Renamed'}]);
  assert.equal(new TextDecoder().decode(await value.provider.readFile('Renamed/A.cs')), 'edited');
  assert.equal(new TextDecoder().decode(await value.provider.readFile('untouched.cs')), 'saved');
  assert.equal(value.state.records.find(record => record.path === 'untouched.cs').text, 'unsaved elsewhere');
  assert.deepEqual(value.state.dirty, ['untouched.cs']);
  assert.equal(value.state.active, 'Renamed/A.cs');
  assert.deepEqual(value.state.tabs, ['Renamed/A.cs', 'untouched.cs']);
  assert(receipt.completedMutations.some(operation => operation.kind === 'rmdir' && operation.path === 'Src'));
  await value.history.undo();
  assert.equal(new TextDecoder().decode(await value.provider.readFile('Src/A.cs')), 'edited');
  assert.equal(value.state.active, 'Src/A.cs');
  await value.history.redo();
  assert.equal(new TextDecoder().decode(await value.provider.readFile('Renamed/A.cs')), 'edited');
  assert(value.disk.record('Renamed/A.cs'));
  assert.equal(value.disk.record('Src/A.cs'), undefined);
});

test('provider journal writes no files when any destination collides or any baseline is stale', async () => {
  const value = await session();
  await value.provider.writeFile('outside.bin', Uint8Array.of(9));
  await assert.rejects(value.history.execute([{kind: 'write', path: 'Src/A.cs', text: 'changed'},
    {kind: 'create', path: 'outside.bin', bytes: Uint8Array.of(1)}]), /changed|Conflict/i);
  assert.equal(new TextDecoder().decode(await value.provider.readFile('Src/A.cs')), 'old');
  await value.provider.writeFile('Src/A.cs', new TextEncoder().encode('external'));
  await assert.rejects(value.history.execute([{kind: 'move', path: 'Src/A.cs', destination: 'B.cs'}]), /changed/i);
  await assert.rejects(value.provider.readFile('B.cs'), error => error.code === 'NotFound');
});

test('provider journal reports each completed physical mutation after a third close failure', async () => {
  let armed = false, count = 0;
  const value = await session({files: [['one.txt', '1'], ['two.txt', '2'], ['three.txt', '3']], folders: [],
    beforeClose() { if (armed && ++count === 3) throw new Error('third close failed'); }});
  const before = structuredClone(value.state);
  armed = true;
  await assert.rejects(value.journal.execute(['one.txt', 'two.txt', 'three.txt'].map(path => ({kind: 'write', path, text: 'new'}))), error => {
    assert.deepEqual(error.completedMutations.map(operation => operation.path), ['one.txt', 'two.txt']);
    return /third close failed/.test(error.message);
  });
  assert.deepEqual(value.state, before);
  assert.equal(new TextDecoder().decode(await value.provider.readFile('one.txt')), 'new');
  assert.equal(new TextDecoder().decode(await value.provider.readFile('three.txt')), '3');
});

test('provider journal materializes an unloaded binary only when affected and undo restores exact bytes', async () => {
  const binary = Uint8Array.of(0, 128, 255);
  const value = await session({files: [['raw.bin', binary], ['other.bin', Uint8Array.of(3)]], folders: []});
  const metadata = await value.provider.stat('raw.bin');
  value.state.records[0] = {path: 'raw.bin', lazy: true, size: 3, mtime: metadata.mtime};
  await value.history.execute([{kind: 'delete', path: 'raw.bin'}]);
  await assert.rejects(value.provider.readFile('raw.bin'), error => error.code === 'NotFound');
  await value.history.undo();
  assert.deepEqual(await value.provider.readFile('raw.bin'), binary);
});

test('provider journal rejects hidden directory entries and disposed ownership before any effect', async () => {
  const value = await session();
  await value.provider.writeFile('Src/untracked.txt', Uint8Array.of(3));
  await assert.rejects(value.history.execute([{kind: 'delete', path: 'Src'}]), /untracked/i);
  assert.equal(new TextDecoder().decode(await value.provider.readFile('Src/A.cs')), 'old');
  value.disk.saveLocks.dispose();
  await assert.rejects(value.history.execute([{kind: 'create', path: 'new.txt', text: 'x'}]), /disposed/i);
  await assert.rejects(value.provider.readFile('new.txt'), error => error.code === 'NotFound');
});

test('provider journal preserves document watermarks through rename, disk cache release and reopen', async () => {
  const value = await session();
  value.disk.replaceRecord({...value.disk.record('Src/A.cs'), version: 12});
  value.state.records[0].version = 12;
  await value.history.execute([{kind: 'move', path: 'Src/A.cs', destination: 'Renamed.cs'}]);
  const committed = value.disk.record('Renamed.cs').version;
  assert(committed > 12);
  assert.equal(value.disk.unload('Renamed.cs'), true);
  const reopened = await value.disk.load('Renamed.cs');
  assert.equal(reopened.text, 'old');
  assert(reopened.version > committed);
  await value.history.undo();
  assert(value.disk.record('Src/A.cs').version > 12);
});

test('provider journal rejects version exhaustion during complete preflight before writing any item', async () => {
  const value = await session();
  value.disk.replaceRecord({...value.disk.record('untouched.cs'), version: Number.MAX_SAFE_INTEGER});
  await assert.rejects(value.history.execute([{kind: 'write', path: 'Src/A.cs', text: 'changed'},
    {kind: 'write', path: 'untouched.cs', text: 'changed'}]), /version space exhausted/);
  assert.equal(new TextDecoder().decode(await value.provider.readFile('Src/A.cs')), 'old');
  assert.equal(new TextDecoder().decode(await value.provider.readFile('untouched.cs')), 'saved');
});
