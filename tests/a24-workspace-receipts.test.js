import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceTransactionJournal, WorkspaceReceiptStore} from '@sharpforge/workspace';
import {memoryDirectory, setHandleText} from './support/memory-directory-handle.js';

test('durable write-ahead receipt exists before the first disk effect and records later partial completion', async () => {
  const directory = memoryDirectory();
  const store = new WorkspaceReceiptStore({directory});
  let state = {records: [{path: 'A.cs', text: 'old'}, {path: 'asset.bin', bytes: Uint8Array.of(0, 128, 255)}], folders: []};
  let applied = 0;
  const journal = new WorkspaceTransactionJournal({getState: () => state, commitState: next => { state = next; }, store,
    adapter: {async apply() {
      const recovery = await new WorkspaceReceiptStore({directory}).load();
      assert.equal(recovery.status, 'prepared');
      assert.equal(recovery.before.records[0].text, 'old');
      if (++applied === 2) throw new Error('second operation failed');
    }}});
  await assert.rejects(journal.execute([{kind: 'write', path: 'A.cs', text: 'new'},
    {kind: 'create', path: 'B.cs', text: 'created'}]), /second operation failed/);
  const recovered = await new WorkspaceReceiptStore({directory}).load();
  assert.equal(recovered.status, 'failed');
  assert.equal(recovered.completedMutations.length, 1);
  assert.deepEqual(recovered.before.records[1].bytes, Uint8Array.of(0, 128, 255));
  assert.equal(recovered.after.records.find(record => record.path === 'B.cs').text, 'created');
  assert.equal(state.records[0].text, 'old');
});

test('receipt snapshots are written once and unloaded metadata remains explicit across progress updates', async () => {
  let snapshots = 0;
  const directory = memoryDirectory({beforeClose(path) { if (/\/(?:before|after)\.json$/.test(path)) snapshots++; }});
  const store = new WorkspaceReceiptStore({directory});
  const state = {records: [{path: 'A.cs', text: 'x'}, {path: 'later.bin', size: 123, lazy: true}], folders: []};
  const receipt = {id: 1, status: 'prepared', label: 'Test', before: state, after: state, operations: [], completedMutations: []};
  await store.save(receipt);
  receipt.status = 'committed';
  await store.save(receipt);
  assert.equal(snapshots, 2);
  const loaded = await store.load();
  assert.equal(loaded.before.records.find(record => record.path === 'later.bin').lazy, true);
  assert.equal(loaded.before.records.find(record => record.path === 'later.bin').text, undefined);
});

test('receipt corruption, limits and cancellation are explicit and never admit a disk effect', async () => {
  const directory = memoryDirectory();
  const state = {records: [{path: 'A.cs', text: 'x'}], folders: []};
  const receipt = {id: 1, status: 'prepared', label: 'Test', before: state, after: state, operations: [], completedMutations: []};
  await assert.rejects(new WorkspaceReceiptStore({directory, maxSnapshotBytes: 1}).save(receipt), /budget/);
  const store = new WorkspaceReceiptStore({directory});
  await assert.rejects(store.save(receipt, {signal: AbortSignal.abort()}), {name: 'AbortError'});
  await store.save(receipt);
  const transaction = await directory.getDirectoryHandle('transaction-1');
  await setHandleText(transaction, 'receipt.json', '{"checksum":"wrong","payload":{}}');
  await assert.rejects(store.load(), /checksum/);
  store.dispose();
  await assert.rejects(store.save(receipt), /disposed/);
});
