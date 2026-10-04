import {handleDatabase} from './support/a24-handle-database.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ExplorerPersistence} from '../apps/studio/explorer/persistence.js';
import {RecentWorkspaceHandles, WorkspaceConflictCoordinator, OpfsRecoveryStore, hashWorkspaceBytes, workspaceRecordBytes}
  from '@sharpforge/workspace';
import {buildSymbolChildren, rewriteProjectPaths} from '@sharpforge/project-system';
import {TreeModel} from '@sharpforge/controls';
import {memoryDirectory} from './support/memory-directory-handle.js';

function transport() {
  const groups = new Map();
  return function BroadcastChannel(name) {
    const endpoints = groups.get(name) ?? new Set();
    groups.set(name, endpoints);
    const channel = new EventTarget();
    endpoints.add(channel);
    channel.postMessage = data => {
      for (const endpoint of endpoints) if (endpoint !== channel) {
        queueMicrotask(() => endpoint.dispatchEvent(new MessageEvent('message', {data: structuredClone(data)})));
      }
    };
    channel.close = () => endpoints.delete(channel);
    return channel;
  };
}

function environment(id, root, BroadcastChannel = transport()) {
  return {crypto: {randomUUID: () => id}, BroadcastChannel, navigator: {storage: {getDirectory: async () => root}}};
}

const workspace = () => ({identity: 'epoch:1', coordinationIdentity: 'explicit-session', name: 'Test', revision: 1,
  records: [{path: 'A.cs', text: 'one'}, {path: 'B.cs', text: 'two'}, {path: 'raw.bin', bytes: Uint8Array.of(0, 128, 255)}],
  folders: [], active: 'A.cs', tabs: ['A.cs']});

test('explorer sends divergent revisions without waiting for recovery and preserves the other buffer', async () => {
  const root = memoryDirectory(), BroadcastChannel = transport();
  let firstState = workspace();
  const secondState = {...workspace(), identity: 'epoch:99'};
  const warnings = [];
  const first = new ExplorerPersistence({getData: () => firstState, environment: environment('first', root, BroadcastChannel),
    onWarning: warning => warnings.push(warning)});
  const second = new ExplorerPersistence({getData: () => secondState, environment: environment('second', root, BroadcastChannel),
    onWarning: warning => warnings.push(warning)});
  try {
    first.observe(firstState);
    second.observe(secondState);
    await Promise.all([first.revisionQueue, second.revisionQueue]);
    firstState = {...firstState, revision: 2, records: firstState.records.map(file => file.path === 'A.cs' ? {...file, text: 'changed'} : file)};
    first.observe(firstState);
    await first.revisionQueue;
    await new Promise(resolve => setImmediate(resolve));
    assert(second.conflicts.conflicts.has('A.cs'));
    assert.equal(secondState.records[0].text, 'one');
    assert.equal(first.savedSignature, null, 'revision delivery is independent of the recovery debounce');
    assert.deepEqual(warnings, []);
  } finally { first.dispose(); second.dispose(); }
});

test('explorer serializes overlapping checkpoints and saves metadata-only changes with binary bytes', async () => {
  let release, announce;
  const blocked = new Promise(resolve => { announce = resolve; });
  const pause = new Promise(resolve => { release = resolve; });
  let held = false;
  const root = memoryDirectory({async beforeClose(path) {
    if (path.endsWith('snapshot-0.json') && !held) { held = true; announce(); await pause; }
  }});
  let state = workspace();
  const persistence = new ExplorerPersistence({getData: () => state, environment: environment('window', root)});
  try {
    persistence.observe(state);
    const first = persistence.checkpoint(state);
    await blocked;
    state = {...state, revision: 2, records: state.records.map(file => file.path === 'A.cs' ? {...file, text: 'later'} : file)};
    persistence.observe(state);
    const second = persistence.checkpoint(state);
    await persistence.revisionQueue;
    release();
    await Promise.all([first, second]);
    state = {...state, tabs: ['B.cs'], active: 'B.cs'};
    await persistence.checkpoint(state);
    const recovered = await persistence.store.load();
    assert.equal(recovered.record.records[0].text, 'later');
    assert.deepEqual(recovered.record.records[2].bytes, Uint8Array.of(0, 128, 255));
    assert.deepEqual(recovered.record.openDocuments.map(document => ({...document})), [{path: 'B.cs'}]);
    assert.equal(recovered.record.active, 'B.cs');
  } finally { release(); persistence.dispose(); }
});

test('unbound workspaces with the same display name never establish an editing channel', async () => {
  const state = {...workspace(), coordinationIdentity: undefined};
  const persistence = new ExplorerPersistence({getData: () => state, environment: environment('private', memoryDirectory())});
  try {
    persistence.observe(state);
    await persistence.revisionQueue;
    assert.equal(persistence.channel, null);
    assert(persistence.store instanceof OpfsRecoveryStore);
  } finally { persistence.dispose(); }
});

test('recent identity registration uses isSameEntry and serializes simultaneous first opens', async () => {
  const database = handleDatabase();
  let tail = Promise.resolve(), nextId = 0;
  const locks = {request(name, options, action) {
    const next = tail.then(() => { options.signal?.throwIfAborted(); return action(); });
    tail = next.then(() => {}, () => {});
    return next;
  }};
  const registry = () => new RecentWorkspaceHandles({indexedDB: database.indexedDB});
  const handle = key => ({kind: 'directory', name: 'Same name', key, async isSameEntry(other) { return key === other.key; }});
  const options = {locks, createId: () => String(++nextId)};
  const values = await Promise.all([registry().identify(handle('one'), options), registry().identify(handle('one'), options)]);
  assert.equal(values[0], values[1]);
  assert.notEqual(await registry().identify(handle('two'), options), values[0]);
  await assert.rejects(registry().identify(handle('one'), {...options, locks: null}), /Web Locks/);
  await assert.rejects(registry().identify(handle('one'), {...options, signal: AbortSignal.abort()}), {name: 'AbortError'});
});

test('cross-window UTF-16 conflict verifies physical encoding and emits the actual persisted hash', async () => {
  const bytes = text => workspaceRecordBytes({text, encoding: 'utf-16le', bom: true});
  const local = {content: 'mine', baseContent: 'base', encoding: 'utf-16le', bom: true, revision: 2, hash: await hashWorkspaceBytes(bytes('mine'))};
  const coordinator = new WorkspaceConflictCoordinator({getDocument: () => local,
    applyResolution: value => Object.assign(local, value), channel: {publishRevision() {}}});
  coordinator.observe({path: 'A.cs', revision: 3, hash: await hashWorkspaceBytes(bytes('theirs'))});
  const result = await coordinator.resolve('A.cs', 'adopt-newer', {readRemote: async () => ({content: 'theirs', bytes: bytes('theirs')})});
  assert.equal(result.hash, await hashWorkspaceBytes(bytes('theirs')));
  assert.equal(local.content, 'theirs');
});

test('missing symbol ids use source interval ownership and malformed owner cycles stay renderable', () => {
  const file = {id: 'file:A.cs', path: 'A.cs', label: 'A.cs'};
  const roots = buildSymbolChildren(file, [{kind: 'class', name: 'Outer', start: 0, end: 30},
    {kind: 'event', name: 'Changed', start: 10, end: 20}, {kind: 'class', name: 'Other', start: 40, end: 60}]);
  assert.equal(roots.length, 2);
  assert.equal(roots[0].children[0].label, 'Changed');
  const duplicateNames = buildSymbolChildren(file, [{kind: 'class', name: 'Same', start: 0, end: 30},
    {kind: 'class', name: 'Same', start: 40, end: 80}, {kind: 'field', name: 'Value', owner: 'Same', start: 50, end: 55}]);
  assert.equal(duplicateNames[0].children.length, 0);
  assert.equal(duplicateNames[1].children[0].symbol.name, 'Value');
  const cyclic = buildSymbolChildren(file, [{id: 'one', kind: 'class', name: 'One', ownerId: 'two'},
    {id: 'two', kind: 'class', name: 'Two', ownerId: 'one'}]);
  const model = new TreeModel(cyclic);
  assert([...model.nodes.values()].some(node => node.diagnostic?.code === 'SFP2404'));
});

test('batch path rewrites rebase original relative paths once across several moves', () => {
  const source = '<Project><ItemGroup><Compile Include="../../Shared/A.cs;../../Shared/B.cs" /></ItemGroup></Project>';
  const result = rewriteProjectPaths(source, {documentPath: 'Old/Config/Items.props', newDocumentPath: 'New/Items.props',
    mappings: [{from: 'Shared/A.cs', to: 'Moved/A.cs'}, {from: 'Shared/B.cs', to: 'Moved/B.cs'}]});
  assert(result.includes('Include="../Moved/A.cs;../Moved/B.cs"'));
});
