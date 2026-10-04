import test from 'node:test';
import assert from 'node:assert/strict';
import {ExplorerPersistence} from '../apps/studio/explorer/persistence.js';
import {WorkspaceConflictCoordinator, OpfsRecoveryStore, hashWorkspaceBytes, workspaceRecordBytes} from '@sharpforge/workspace';
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

const loaded = {path: 'A.cs', text: 'class A {}', version: 41};
const lazy = {path: 'cafe\u0301/B.cs', lazy: true, size: 70, lastModified: 123, compile: true};

test('the explorer checkpoints unopened membership and unsaved paths along with loaded bytes', async () => {
  const root = memoryDirectory();
  const data = {identity: 'session', name: 'Recovery', revision: 1, records: [loaded, lazy], folders: ['Empty'],
    active: 'A.cs', tabs: ['A.cs', lazy.path], dirty: ['A.cs']};
  const persistence = new ExplorerPersistence({getData: () => data, environment: {
    crypto: {randomUUID: () => 'window'}, navigator: {storage: {getDirectory: async () => root}}}});
  try {
    persistence.observe(data);
    await persistence.checkpoint(data);
    const recovered = (await persistence.store.load()).record;
    assert.equal(recovered.records.length, 2);
    assert.deepEqual(recovered.records[1], lazy);
    assert.deepEqual(recovered.dirty, ['A.cs']);
    data.dirty = [];
    await persistence.checkpoint(data);
    assert.deepEqual((await persistence.store.load()).record.dirty, []);
  } finally { persistence.dispose(); }
});

test('Explorer drops closed source bodies and merge baselines, retaining a numeric revision watermark and rejecting stale queue contents', async () => {
  let data = {identity: 'one', name: 'One', records: [{path: 'A.cs', text: 'class A {}', version: 7}], tabs: ['A.cs'], dirty: []};
  const persistence = new ExplorerPersistence({getData: () => data, environment: {}});
  try {
    persistence.observe(data);
    await persistence.revisionQueue;
    const previous = persistence.documents.get('A.cs').revision;
    const stale = data;
    data = {...data, records: [{path: 'A.cs', size: 10, version: 7, lazy: true}], tabs: []};
    assert.equal(persistence.releaseDocument('A.cs'), true);
    await persistence.updateRevisions(stale, persistence.generation);
    assert.equal(persistence.documents.get('A.cs').content, undefined);
    assert.equal(persistence.documents.get('A.cs').text, undefined);
    assert.equal(persistence.baselines.has('A.cs'), false);
    assert.equal(persistence.documentFor('A.cs'), null);
    data = {...data, records: [{path: 'A.cs', text: 'class Reloaded {}', version: 8}], tabs: ['A.cs']};
    persistence.observe(data);
    await persistence.revisionQueue;
    assert(persistence.documents.get('A.cs').revision > previous);
    assert.equal(persistence.documents.get('A.cs').text, 'class Reloaded {}');
  } finally { persistence.dispose(); }
});
