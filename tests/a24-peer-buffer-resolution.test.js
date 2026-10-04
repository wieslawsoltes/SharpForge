import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeWorkspaceFile} from '@sharpforge/archive';
import {WorkspaceTransactionJournal, FileOperationHistory, hashWorkspaceBytes, workspaceRecordBytes} from '@sharpforge/workspace';
import {applyWorkspaceConflictResolution} from '../apps/studio/workspace-conflicts.js';

function fixture(record = {path: 'A.cs', text: 'first\nsecond\n', version: 9}) {
  const state = {identity: 'folder', revision: 1, records: [record, {path: 'B.cs', text: 'unrelated edit', version: 4}],
    folders: [], dirty: ['B.cs'], disk: {baselineHashes: new Map([['A.cs', 'original-baseline']])}};
  const commits = [];
  const host = {context: () => state};
  const session = {commit: async next => { commits.push(next); Object.assign(state, next, {revision: state.revision + 1}); }};
  return {state, host, session, commits};
}

async function selected(app, content = 'peer\nsecond\n') {
  const source = app.state.records[0];
  const bytes = typeof content === 'string' ? workspaceRecordBytes({...source, text: content}) : content;
  return {path: source.path, content, bytes, hash: await hashWorkspaceBytes(bytes),
    expectedLocalHash: await hashWorkspaceBytes(workspaceRecordBytes(source)), choice: 'adopt-newer'};
}

test('peer resolution commits the reviewed version as dirty while preserving unrelated buffers and physical baselines', async () => {
  const app = fixture();
  const other = app.state.records[1];
  const baseline = [...app.state.disk.baselineHashes];
  const result = await applyWorkspaceConflictResolution(app.host, app.session, await selected(app));
  assert.equal(app.state.records[0].text, 'peer\nsecond\n');
  assert.equal(app.state.records[0].version, 10);
  assert.equal(app.state.records[1], other);
  assert.deepEqual(app.state.dirty, ['B.cs', 'A.cs']);
  assert.deepEqual([...app.state.disk.baselineHashes], baseline);
  assert.equal(app.commits[0].preserveMembership, true);
  assert.equal(app.commits[0].diskCommitted, undefined);
  assert.equal(result.dirty, true);
});

test('selected text, binary and encoding metadata reproduce the exact reviewed bytes', async () => {
  for (const binary of [false, true]) {
    const input = binary ? Uint8Array.of(0, 255, 2) : Uint8Array.of(255, 254, 65, 0, 13, 0, 10, 0, 66, 0, 10, 0);
    const app = fixture({...decodeWorkspaceFile(binary ? 'raw.bin' : 'A.cs', input), version: 7});
    const resolution = await selected(app, binary ? Uint8Array.of(128, 0, 254) : 'Peer\r\nB\n');
    await applyWorkspaceConflictResolution(app.host, app.session, resolution);
    assert.deepEqual(workspaceRecordBytes(app.state.records[0]), resolution.bytes);
    if (!binary) assert.equal(app.state.records[0].encoding, 'utf-16le');
    else assert.equal(app.state.records[0].text, undefined);
  }
});

test('unreviewed hashes, contents, budgets and cancelled requests never commit a peer buffer', async () => {
  const app = fixture();
  const resolution = await selected(app);
  const invalid = [[{hash: '0'.repeat(64)}, /Selected bytes do not match the reviewed hash/],
    [{expectedLocalHash: '0'.repeat(64)}, /Local document hash changed/],
    [{content: 'unreviewed'}, /Selected content does not match its reviewed bytes/],
    [{bytes: null}, /lack exact bytes/]];
  for (const [update, message] of invalid) {
    await assert.rejects(applyWorkspaceConflictResolution(app.host, app.session, {...resolution, ...update}), error => {
      assert.equal(error.code, 'SFW1424');
      assert.match(error.message, message);
      return true;
    });
  }
  await assert.rejects(applyWorkspaceConflictResolution(app.host, app.session, resolution, {maxBytes: 1}), /budget/);
  await assert.rejects(applyWorkspaceConflictResolution(app.host, app.session, resolution, {signal: AbortSignal.abort()}), {name: 'AbortError'});
  assert.equal(app.commits.length, 0);
  assert.equal(app.state.records[0].text, 'first\nsecond\n');
});

test('in-place context, version, protection and byte changes during hashing invalidate the captured local snapshot', async () => {
  for (const mutation of ['identity', 'revision', 'version', 'readOnly', 'generated', 'native', 'bytes']) {
    const app = fixture({path: 'raw.bin', bytes: Uint8Array.of(0, 255, 2), version: 4});
    const resolution = await selected(app, Uint8Array.of(1, 2));
    const pending = applyWorkspaceConflictResolution(app.host, app.session, resolution);
    queueMicrotask(() => {
      if (mutation === 'identity') app.state.identity = 'another';
      if (mutation === 'revision') app.state.revision++;
      if (mutation === 'native') app.state.native = true;
      if (mutation === 'version') app.state.records[0].version++;
      if (mutation === 'readOnly') app.state.records[0].readOnly = true;
      if (mutation === 'generated') app.state.generated = [{path: 'raw.bin'}];
      if (mutation === 'bytes') app.state.records[0].bytes[0] = 128;
    });
    await assert.rejects(pending, /changed during resolution/, mutation);
    assert.equal(app.commits.length, 0, mutation);
  }
});

test('protected, unloaded, missing and exhausted-version records retain their existing contents', async () => {
  for (const kind of ['generated', 'readOnly', 'lazy', 'missing', 'version']) {
    const app = fixture();
    const resolution = await selected(app);
    if (kind === 'generated') app.state.records[0].generated = true;
    if (kind === 'readOnly') app.state.readOnly = true;
    if (kind === 'missing') app.state.records.shift();
    if (kind === 'version') app.state.records[0].version = Number.MAX_SAFE_INTEGER;
    if (kind === 'lazy') app.state.records[0] = {path: 'A.cs', lazy: true, size: 42};
    await assert.rejects(applyWorkspaceConflictResolution(app.host, app.session, resolution),
      /Generated|read-only|Load the conflicted|missing|version space exhausted/);
    assert.equal(app.commits.length, 0, kind);
  }
});

test('reviewed peer edits prevent obsolete file undo and redo from overwriting a newer buffer', async () => {
  for (const redo of [false, true]) {
    const app = fixture();
    const journal = new WorkspaceTransactionJournal({getState: app.host.context, commitState: app.session.commit});
    const history = new FileOperationHistory(journal);
    await history.execute([{kind: 'create', path: 'new.txt', text: 'created'}]);
    if (redo) await history.undo();
    await applyWorkspaceConflictResolution(app.host, app.session, await selected(app));
    const sizes = [history.undoStack.length, history.redoStack.length];
    await assert.rejects(redo ? history.redo() : history.undo(), /newer edits/i);
    assert.deepEqual([history.undoStack.length, history.redoStack.length], sizes);
    assert.equal(app.state.records[0].text, 'peer\nsecond\n');
    assert(app.state.dirty.includes('A.cs'));
    journal.dispose();
  }
});
