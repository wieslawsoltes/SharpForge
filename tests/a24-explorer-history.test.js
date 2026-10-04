import test from 'node:test';
import assert from 'node:assert/strict';
import {FileSystemAccessProvider, WorkspaceSaveLocks} from '@sharpforge/workspace';
import {ProviderDiskWorkspace} from '@sharpforge/project-system';
import {decodeWorkspaceFile} from '@sharpforge/archive';
import {createExplorerHistory, performExplorerOperations, undoExplorerOperation} from '../apps/studio/explorer/operation-history.js';
import {memoryDirectory} from './support/memory-directory-handle.js';

function fixture(records = [], extra = {}) {
  let context = {identity: 'test', records, folders: [], tabs: [], dirty: [], ...extra};
  const commits = [], receipts = [], events = [];
  const commands = {context: () => context, operationIdentity: 'test', history: [],
    host: {context: () => context, render() {}, notice: text => events.push(text),
      commit: async value => { commits.push(value); context = {...context, ...value}; },
      explorer: {prepareMappings: paths => events.push(['prepare', paths]), remapSelection: paths => events.push(['select', paths]),
        persistence: {ready: async () => events.push('ready'), saveReceipt: async receipt => receipts.push(structuredClone(receipt))}}}};
  commands.fileHistory = createExplorerHistory(commands);
  return {commands, commits, receipts, events, get context() { return context; }};
}

test('Explorer history normalizes binary operations and validates complete XML batches before publishing buffers', async () => {
  const app = fixture();
  await assert.rejects(performExplorerOperations(app.commands, [{kind: 'create', path: 'first.txt', text: 'first'},
    {kind: 'create', path: 'Broken.csproj', text: '<Project>'}]), /XML|closing|element|Unexpected/i);
  assert.equal(app.context.records.length, 0);
  assert.equal(app.commands.busy, false);
  await assert.rejects(performExplorerOperations(app.commands, [{kind: 'create', path: 'raw.bin', base64: '!!!'}]), /Invalid/);
  await performExplorerOperations(app.commands, [{kind: 'create', path: 'raw.bin', base64: 'AP8C'}]);
  assert.deepEqual(app.context.records[0].bytes, Uint8Array.of(0, 255, 2));
  assert.equal(app.commits[0].diskCommitted, false);
  assert.equal(app.receipts.at(-1).status, 'committed');
  await undoExplorerOperation(app.commands);
  assert.equal(app.context.records.length, 0);
  await undoExplorerOperation(app.commands, true);
  assert.deepEqual(app.context.records[0].bytes, Uint8Array.of(0, 255, 2));
  app.commands.fileHistory.journal.dispose();
});

test('Explorer history persists physical changes and supplies precise dirty and completed-path metadata to the host', async () => {
  const root = memoryDirectory();
  const provider = new FileSystemAccessProvider(root);
  const records = [];
  for (const [path, text] of [['A.cs', 'old A'], ['B.cs', 'old B']]) {
    const bytes = new TextEncoder().encode(text);
    await provider.writeFile(path, bytes);
    records.push(decodeWorkspaceFile(path, bytes));
  }
  const locks = new WorkspaceSaveLocks({identity: 'physical-test', locks: {request: (_key, _options, action) => action()}});
  const disk = new ProviderDiskWorkspace(records, new Map(), 'Folder', [], [], {rootHandle: root, provider, saveLocks: locks});
  await disk.initializeBaselines();
  const app = fixture(records.map(record => ({...record, text: record.path === 'A.cs' ? 'edited A' : 'unsaved B'})),
    {disk, dirty: ['A.cs', 'B.cs'], active: 'A.cs', tabs: ['A.cs']});
  await performExplorerOperations(app.commands, [{kind: 'move', path: 'A.cs', destination: 'New.cs'}], [{from: 'A.cs', to: 'New.cs'}]);
  assert.equal(new TextDecoder().decode(await provider.readFile('New.cs')), 'edited A');
  assert.equal(new TextDecoder().decode(await provider.readFile('B.cs')), 'old B');
  assert.deepEqual(app.commits[0].persistedPaths, ['New.cs']);
  assert.deepEqual(app.commits[0].dirty, ['B.cs']);
  assert.equal(app.commits[0].diskCommitted, true);
  assert.equal(app.context.records.find(record => record.path === 'B.cs').text, 'unsaved B');
  assert.equal(disk.record('B.cs').text, 'old B');
  assert.equal(app.events[0], 'ready');
  assert(app.receipts.some(receipt => receipt.completedMutations.some(value => value.kind === 'write' && value.path === 'New.cs')));
  await undoExplorerOperation(app.commands);
  assert.equal(new TextDecoder().decode(await provider.readFile('A.cs')), 'edited A');
  app.commands.fileHistory.journal.dispose();
  locks.dispose();
});

test('Explorer history rejects retired identity and changed project read sets before preparing an operation', async () => {
  const app = fixture([{path: 'App.csproj', text: '<Project/>'}]);
  app.commands.operationIdentity = 'retired';
  await assert.rejects(performExplorerOperations(app.commands, [{kind: 'create', path: 'A.cs', text: 'class A {}'}]), /Workspace changed/);
  app.commands.operationIdentity = 'test';
  app.commands.readSet = new Map([['App.csproj', '<Project Sdk="Microsoft.NET.Sdk"/>']]);
  await assert.rejects(performExplorerOperations(app.commands, [{kind: 'create', path: 'A.cs', text: 'class A {}'}]), /Project changed/);
  assert.equal(app.context.records.length, 1);
  assert.equal(app.receipts.length, 0);
  assert.equal(app.commands.busy, false);
  app.commands.fileHistory.journal.dispose();
});

test('native history preserves quarantine tokens on failure and forwards exact binary and expected-hash mutation contracts', async () => {
  const calls = [];
  const failure = Object.assign(new Error('Second operation failed'), {undoToken: 'quarantine', completedMutations: [{path: 'new.bin'}]});
  const client = {inspectItem: async path => ({hash: 'hash:' + path}),
    mutate: async operations => { calls.push(operations); throw failure; }, undoMutation: async token => calls.push(['undo', token])};
  const app = fixture([{path: 'A.cs', text: 'original'}], {native: true, client});
  app.commands.host.saveNative = async () => calls.push('save');
  app.commands.host.refreshNative = async mappings => calls.push(['refresh', mappings]);
  await assert.rejects(performExplorerOperations(app.commands, [{kind: 'create', path: 'new.bin', base64: 'AP8C'},
    {kind: 'move', path: 'A.cs', destination: 'B.cs'}], [{from: 'A.cs', to: 'B.cs'}]), /Second operation failed/);
  assert.equal(calls[1][0].base64, 'AP8C');
  assert.equal(calls[1][1].expectedHash, 'hash:A.cs');
  assert.equal(app.commands.history[0].token, 'quarantine');
  assert.equal(app.context.records[0].path, 'A.cs');
  await undoExplorerOperation(app.commands);
  assert(calls.some(value => Array.isArray(value) && value[0] === 'undo' && value[1] === 'quarantine'));
  assert.deepEqual(calls.at(-1), ['refresh', [{from: 'B.cs', to: 'A.cs'}]]);
  await assert.rejects(undoExplorerOperation(app.commands, true), /Native file redo requires/);
  assert.equal(app.commands.busy, false);
  app.commands.fileHistory.journal.dispose();
});
