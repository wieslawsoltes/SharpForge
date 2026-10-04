import test from 'node:test';
import assert from 'node:assert/strict';
import {readProviderDirectory as readDirectory} from '@sharpforge/project-system';
import {decodeWorkspaceFile} from '@sharpforge/archive';
import {WorkspaceConflictCoordinator, hashWorkspaceBytes, workspaceRecordBytes} from '@sharpforge/workspace';
import {ExplorerCommands} from '../apps/studio/explorer-commands.js';
import {applyWorkspaceConflictResolution} from '../apps/studio/workspace-conflicts.js';
import {application, directoryFiles} from './support/workspace-application.js';

const bytes = text => new TextEncoder().encode(text);
const text = async (provider, path = 'A.cs') => new TextDecoder().decode(await provider.readFile(path));
const contents = (value, path = 'A.cs') => value.host.context().records.find(record => record.path === path);

async function open(disk) {
  const value = application();
  await value.session.load(disk.records, {disk, mode: 'folder'});
  value.commands = new ExplorerCommands({context: value.host.context, commit: value.session.commit,
    render() {}, error(error) { value.events.push(error.message); }, notice() {},
    applyConflictResolution: resolution => applyWorkspaceConflictResolution(value.host, value.session, resolution)});
  return value;
}

async function resolution(value, content, path = 'A.cs') {
  const before = contents(value, path);
  const data = typeof content === 'string' ? workspaceRecordBytes({...before, text: content}) : content;
  return {path, content, bytes: data, hash: await hashWorkspaceBytes(data),
    expectedLocalHash: await hashWorkspaceBytes(workspaceRecordBytes(before)), revision: 9, choice: 'adopt-newer'};
}

test('cross-window adoption keeps both sessions dirty until an explicit physical save', async () => {
  const {disk, provider} = await directoryFiles([['A.cs', 'class A {}'], ['B.cs', 'class B {}']]);
  const peerDisk = await readDirectory(disk.rootHandle, {provider});
  peerDisk.saveLocks = disk.saveLocks;
  const first = await open(disk), second = await open(peerDisk);
  try {
    first.edit('A.cs', 'class A { int First; }');
    second.edit('B.cs', 'class B { int Other; }');
    const initialBaseline = peerDisk.baselineHashes.get('A.cs');
    const remote = await resolution(second, contents(first).text);
    const applied = await second.commands.run('apply-conflict-resolution', null, [], {resolution: remote});
    assert.equal(applied.error, undefined);
    assert.equal(contents(second).text, contents(first).text);
    assert.deepEqual([...second.state.dirtyFiles].sort(), ['A.cs', 'B.cs']);
    assert.equal(second.state.membershipDirty, false);
    assert.equal(await text(provider), 'class A {}', 'resolving an unsaved peer must not write disk');
    assert.equal(peerDisk.baselineHashes.get('A.cs'), initialBaseline);
    assert.equal(second.commands.fileHistory.length, 0, 'buffer resolution is separate from physical file history');
    const reverse = await resolution(first, contents(second).text);
    await first.commands.run('apply-conflict-resolution', null, [], {resolution: reverse});
    assert.equal(await text(provider), 'class A {}', 'the peer can adopt without a stale physical baseline');
    await first.session.save();
    assert.equal(await text(provider), 'class A { int First; }');
    assert.equal(first.state.dirtyFiles.has('A.cs'), false);
    assert.equal(second.state.dirtyFiles.has('A.cs'), true, 'another window saving cannot silently clear this editor');
    assert.equal(await text(provider, 'B.cs'), 'class B {}', 'unrelated peer edits remain private');
  } finally { first.commands.dispose(); second.commands.dispose(); }
});

for (const redo of [false, true]) test(`a peer buffer resolution prevents older file ${redo ? 'redo' : 'undo'} from overwriting it`, async () => {
  const {disk, provider} = await directoryFiles([['A.cs', 'class A {}']]);
  const value = await open(disk);
  try {
    await value.commands.perform([{kind: 'create', path: 'new.txt', text: 'created'}]);
    if (redo) await value.commands.undo();
    const before = {undo: value.commands.fileHistory.undoStack.length, redo: value.commands.fileHistory.redoStack.length};
    await applyWorkspaceConflictResolution(value.host, value.session, await resolution(value, 'class A { int Peer; }'));
    await assert.rejects(redo ? value.commands.redo() : value.commands.undo(), /newer edits/i);
    assert.equal(contents(value).text, 'class A { int Peer; }');
    assert.equal(await text(provider), 'class A {}');
    assert.equal(value.state.dirtyFiles.has('A.cs'), true);
    assert.equal(value.commands.fileHistory.undoStack.length, before.undo);
    assert.equal(value.commands.fileHistory.redoStack.length, before.redo);
  } finally { value.commands.dispose(); }
});

test('cross-window application verifies exact local and selected bytes before changing a buffer', async () => {
  const {disk, provider} = await directoryFiles([['A.cs', 'class A {}']]);
  const value = await open(disk);
  try {
    const selected = await resolution(value, 'class A { int Peer; }');
    value.edit('A.cs', 'class A { int Local; }');
    await assert.rejects(applyWorkspaceConflictResolution(value.host, value.session, selected), /changed/i);
    const valid = await resolution(value, 'class A { int Peer; }');
    await assert.rejects(applyWorkspaceConflictResolution(value.host, value.session,
      {...valid, hash: '0'.repeat(64)}), /hash|bytes/i);
    await assert.rejects(applyWorkspaceConflictResolution(value.host, value.session,
      {...valid, content: 'unreviewed content'}), /bytes|content/i);
    await assert.rejects(applyWorkspaceConflictResolution(value.host, value.session, valid,
      {signal: AbortSignal.abort()}), {name: 'AbortError'});
    assert.equal(contents(value).text, 'class A { int Local; }');
    assert.equal(await text(provider), 'class A {}');
  } finally { value.commands.dispose(); }
});

test('read-only, generated, missing, malformed and oversized peer resolutions are rejected', async () => {
  const {disk} = await directoryFiles([['A.cs', 'class A {}']]);
  const value = await open(disk);
  try {
    const selected = await resolution(value, 'class A { int Peer; }');
    value.state.readOnly = true;
    await assert.rejects(applyWorkspaceConflictResolution(value.host, value.session, selected), /read.only/i);
    value.state.readOnly = false;
    value.state.result = {generatedSources: [{path: 'A.cs'}]};
    await assert.rejects(applyWorkspaceConflictResolution(value.host, value.session, selected), /generated/i);
    value.state.result = null;
    await assert.rejects(applyWorkspaceConflictResolution(value.host, value.session, {...selected, path: 'missing.cs'}), /missing/i);
    await assert.rejects(applyWorkspaceConflictResolution(value.host, value.session, {...selected, expectedLocalHash: null}), /hash/i);
    await assert.rejects(applyWorkspaceConflictResolution(value.host, value.session, selected, {maxBytes: 1}), /budget/i);
    delete value.commands.host.applyConflictResolution;
    assert.match((await value.commands.run('apply-conflict-resolution', null, [], {resolution: selected})).error, /unavailable/i);
    assert.equal(value.state.dirtyFiles.size, 0);
  } finally { value.commands.dispose(); }
});

for (const change of ['edit', 'replace', 'bytes']) test(`an asynchronous ${change} invalidates peer application before the session commit`, async () => {
  const {disk} = await directoryFiles([['A.cs', 'class A {}'], ['raw.bin', Uint8Array.of(0, 128, 255)]]);
  const value = await open(disk);
  try {
    const path = change === 'bytes' ? 'raw.bin' : 'A.cs';
    const selected = await resolution(value, change === 'bytes' ? Uint8Array.of(3) : 'class Peer {}', path);
    const pending = applyWorkspaceConflictResolution(value.host, value.session, selected);
    queueMicrotask(() => {
      if (change === 'edit') value.edit('A.cs', 'class Newer {}');
      if (change === 'replace') value.state.workspaceEpoch++;
      if (change === 'bytes') contents(value, 'raw.bin').bytes[1] = 254;
    });
    await assert.rejects(pending, /changed/i);
    assert.notEqual(contents(value).text, 'class Peer {}');
    assert.equal(contents(value, 'raw.bin').bytes.length, 3);
  } finally { value.commands.dispose(); }
});

test('coordinator snapshots local admission before an awaited remote read mutates the same object', async () => {
  const local = {content: 'mine', baseContent: 'base', revision: 2, hash: await hashWorkspaceBytes(bytes('mine'))};
  const remote = {path: 'A.cs', revision: 3, hash: await hashWorkspaceBytes(bytes('theirs'))};
  let applied = false;
  const coordinator = new WorkspaceConflictCoordinator({getDocument: () => local,
    applyResolution() { applied = true; }, channel: {publishRevision() {}}});
  coordinator.observe(remote);
  await assert.rejects(coordinator.resolve('A.cs', 'adopt-newer', {readRemote: async () => {
    local.content = 'new local edit';
    local.hash = await hashWorkspaceBytes(bytes(local.content));
    local.revision++;
    return {text: 'theirs'};
  }}), /changed/i);
  assert.equal(applied, false);
  assert.equal(local.content, 'new local edit');
  assert(coordinator.conflicts.has('A.cs'));
});

test('a newer notification invalidates an older remote checkpoint before conflict application', async () => {
  const local = {content: 'mine', baseContent: 'base', revision: 2, hash: await hashWorkspaceBytes(bytes('mine'))};
  const oldRemote = {path: 'A.cs', revision: 3, hash: await hashWorkspaceBytes(bytes('old remote'))};
  const newRemote = {path: 'A.cs', revision: 4, hash: await hashWorkspaceBytes(bytes('new remote'))};
  let applied = false;
  const coordinator = new WorkspaceConflictCoordinator({getDocument: () => local,
    applyResolution() { applied = true; }, channel: {publishRevision() {}}});
  coordinator.observe(oldRemote);
  await assert.rejects(coordinator.resolve('A.cs', 'adopt-newer', {readRemote: async () => {
    coordinator.observe(newRemote);
    return {text: 'old remote'};
  }}), /remote.*changed/i);
  assert.equal(applied, false);
  assert.equal(coordinator.conflicts.get('A.cs').remote.hash, newRemote.hash);
  assert.equal(coordinator.pending.size, 0);
});

for (const newer of ['newer remote', 'mine']) test(`a remote notification during async application remains visible (${newer})`, async () => {
  let local = {content: 'mine', baseContent: 'base', revision: 2, hash: await hashWorkspaceBytes(bytes('mine'))};
  const oldRemote = {path: 'A.cs', revision: 3, hash: await hashWorkspaceBytes(bytes('old remote'))};
  const newRemote = {path: 'A.cs', revision: 4, hash: await hashWorkspaceBytes(bytes(newer))};
  const coordinator = new WorkspaceConflictCoordinator({getDocument: () => local, channel: {publishRevision() {}},
    applyResolution: async selected => {
      coordinator.observe(newRemote);
      local = {...local, ...selected};
    }});
  coordinator.observe(oldRemote);
  const result = await coordinator.resolve('A.cs', 'adopt-newer', {readRemote: async () => ({text: 'old remote'})});
  assert.equal(result.pendingConflict, true);
  assert.equal(local.content, 'old remote', 'the admitted choice was committed before the newer notification was reconciled');
  assert.equal(coordinator.conflicts.get('A.cs').remote.hash, newRemote.hash);
  assert.equal(coordinator.conflicts.get('A.cs').local.hash, oldRemote.hash);
  assert.equal(coordinator.pending.size, 0);
});

test('a document admits one resolution at a time and cancellation reads no remote checkpoint', async () => {
  let local = {content: 'mine', baseContent: 'base', revision: 2, hash: await hashWorkspaceBytes(bytes('mine'))};
  const remote = {path: 'A.cs', revision: 3, hash: await hashWorkspaceBytes(bytes('theirs'))};
  const coordinator = new WorkspaceConflictCoordinator({getDocument: () => local,
    applyResolution: selected => { local = {...local, ...selected}; }, channel: {publishRevision() {}}});
  coordinator.observe(remote);
  let reads = 0, release;
  const pause = new Promise(resolve => { release = resolve; });
  const readRemote = () => { reads++; return pause; };
  await assert.rejects(coordinator.resolve('A.cs', 'keep-mine', {readRemote, signal: AbortSignal.abort()}), {name: 'AbortError'});
  assert.equal(reads, 0);
  const first = coordinator.resolve('A.cs', 'adopt-newer', {readRemote});
  await assert.rejects(coordinator.resolve('A.cs', 'keep-mine', {readRemote}), /already in progress/i);
  release({text: 'theirs'});
  await first;
  assert.equal(reads, 1);
  assert.equal(coordinator.pending.size, 0);
});

test('coordinator and session preserve UTF-16 mixed endings and binary bytes through an unsaved adoption', async () => {
  const original = workspaceRecordBytes({text: 'one\r\ntwo\n', encoding: 'utf-16le', bom: true});
  const {disk, provider} = await directoryFiles([['A.cs', original], ['raw.bin', Uint8Array.of(0, 128, 255)]]);
  const value = await open(disk);
  try {
    value.edit('A.cs', 'ONE\ntwo\n');
    const file = contents(value);
    const local = {...file, content: file.text, baseContent: 'one\ntwo\n', revision: 2,
      hash: await hashWorkspaceBytes(workspaceRecordBytes(file))};
    const remoteText = 'one\nTWO\n';
    const remoteBytes = workspaceRecordBytes({...file, text: remoteText});
    const publications = [];
    const coordinator = new WorkspaceConflictCoordinator({getDocument: () => local,
      applyResolution: selected => applyWorkspaceConflictResolution(value.host, value.session, selected),
      channel: {publishRevision: selected => publications.push(selected)}});
    coordinator.observe({path: 'A.cs', revision: 3, hash: await hashWorkspaceBytes(remoteBytes)});
    const result = await coordinator.resolve('A.cs', 'merge', {readRemote: async () => ({content: remoteText, bytes: remoteBytes})});
    assert.equal(contents(value).text, 'ONE\nTWO\n');
    assert.equal(contents(value).encoding, 'utf-16le');
    assert.equal(contents(value).bom, true);
    const actual = workspaceRecordBytes(contents(value));
    assert.equal(decodeWorkspaceFile('A.cs', actual).text, 'ONE\r\nTWO\n');
    assert.equal(result.hash, await hashWorkspaceBytes(actual));
    assert.equal(publications[0].hash, result.hash);
    const binary = Uint8Array.of(255, 0, 191, 128);
    await applyWorkspaceConflictResolution(value.host, value.session, await resolution(value, binary, 'raw.bin'));
    assert.deepEqual(contents(value, 'raw.bin').bytes, binary);
    assert.deepEqual(await provider.readFile('raw.bin'), Uint8Array.of(0, 128, 255));
    assert.deepEqual(await provider.readFile('A.cs'), original);
    await value.session.save();
    assert.deepEqual(await provider.readFile('A.cs'), actual);
    assert.deepEqual(await provider.readFile('raw.bin'), binary);
  } finally { value.commands.dispose(); }
});
