import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceTransactionJournal, WorkspaceReceiptStore, OpfsRecoveryStore, workspaceRecordBytes,
  encodeRecoveryRecord, decodeRecoveryRecord, migrateWorkspaceRecovery} from '@sharpforge/workspace';
import {prepared, referenceBytes} from './support/prepared-workspace-record.js';
import {memoryDirectory} from './support/memory-directory-handle.js';

test('prepared recovery round trips shared source/baseline roots, lazy membership and exact original encoding', async () => {
  const text = 'one\r\n' + 'x'.repeat(65536) + '\r\ntwo\r\n';
  const record = prepared('Saved.cs', text, {encoding: 'utf-16be', bom: true});
  const baseline = record.source;
  record.bytes = new Uint8Array(referenceBytes(text, 'utf-16be', true));
  Object.defineProperty(record, 'originalSource', {value: baseline});
  const value = {records: [record, {path: 'Closed.cs', lazy: true, size: 42}], folders: [],
    documentStates: new Map([['Saved.cs', {uri: 'Saved.cs', source: baseline, baseline, dirty: false, staleSave: false}]]),
    openDocuments: ['Saved.cs'], settings: {token: 'must-not-persist'}};
  const encoded = await encodeRecoveryRecord(value);
  assert.equal(JSON.parse(encoded).version, 2);
  assert(!encoded.includes('must-not-persist'));
  const restored = await decodeRecoveryRecord(encoded);
  const source = restored.records[0].source;
  assert.equal(restored.documentStates.get('Saved.cs').source, source);
  assert.equal(restored.documentStates.get('Saved.cs').baseline, source);
  assert.equal(restored.records[0].originalSource, source);
  assert.deepEqual(workspaceRecordBytes(restored.records[0]), record.bytes);
  assert.deepEqual(restored.records[1], {path: 'Closed.cs', size: 42, lazy: true});
  assert.equal(source.statistics.textMaterialized, false);
  assert.equal(record.source.statistics.textMaterialized, false);
  const corrupt = encoded.replace('one\\r\\n', 'bad\\r\\n');
  assert.notEqual(corrupt, encoded);
  await assert.rejects(decodeRecoveryRecord(corrupt), /checksum/);
  await assert.rejects(decodeRecoveryRecord(encoded, {maxBytes: 1}), /limit/);
  assert.throws(() => migrateWorkspaceRecovery({...value, documentStates: new Map([['Missing.cs', {source: baseline}]])}), /membership/);
});

test('durable receipts seal the adopted dirty/baseline state after a prepared snapshot without model serialization', async () => {
  const source = prepared('A.cs', 'before');
  let state = {records: [source], folders: [], dirty: [],
    documentStates: new Map([['A.cs', {uri: 'A.cs', source: source.source, baseline: source.source, dirty: false}]])};
  const store = new WorkspaceReceiptStore({directory: memoryDirectory()});
  const journal = new WorkspaceTransactionJournal({getState: () => state, store,
    commitState(value, {transaction}) {
      state = value;
      const updated = value.records[0].source;
      state.documentStates = new Map([['A.cs', {uri: 'A.cs', source: updated, baseline: source.source, dirty: true}]]);
      state.dirty = ['A.cs'];
      transaction.after.documentStates = state.documentStates;
      transaction.after.dirty = state.dirty;
    }});
  await journal.execute([{kind: 'write', path: 'A.cs', text: 'after'}]);
  const recovered = await store.load();
  assert.equal(recovered.status, 'committed');
  assert.equal(recovered.before.records[0].source.getText(), 'before');
  assert.equal(recovered.after.records[0].source.getText(), 'after');
  assert.equal(recovered.after.documentStates.get('A.cs').source, recovered.after.records[0].source);
  assert.equal(recovered.after.documentStates.get('A.cs').baseline.getText(), 'before');
  assert.equal(recovered.after.documentStates.get('A.cs').dirty, true);
  assert.deepEqual(recovered.after.dirty, ['A.cs']);
  assert.equal(state.records[0].source.statistics.textMaterialized, false);
});

test('OPFS failure retains its last prepared-source checkpoint', async () => {
  let fail = false;
  const directory = memoryDirectory({beforeClose(path) {
    if (fail && path === 'current.json') throw new Error('checkpoint manifest rejected');
  }});
  const first = prepared('A.cs', 'first');
  const store = new OpfsRecoveryStore({directory});
  await store.save({records: [first], folders: []});
  fail = true;
  await assert.rejects(store.save({records: [prepared('A.cs', 'second')], folders: []}), /manifest rejected/);
  fail = false;
  assert.equal((await store.load()).record.records[0].source.getText(), 'first');
  assert.equal(first.source.statistics.textMaterialized, false);
});

test('a restarted journal cannot corrupt its last durable receipt when new snapshot admission fails', async () => {
  let fail = false;
  const directory = memoryDirectory({beforeClose(path) {
    if (fail && path.endsWith('/after.json')) throw new Error('new receipt snapshot rejected');
  }});
  let state = {records: [prepared('A.cs', 'original')], folders: []};
  const createJournal = () => new WorkspaceTransactionJournal({getState: () => state,
    commitState(value) { state = value; }, store: new WorkspaceReceiptStore({directory})});
  await createJournal().execute([{kind: 'write', path: 'A.cs', text: 'saved operation'}]);
  fail = true;
  await assert.rejects(createJournal().execute([{kind: 'write', path: 'A.cs', text: 'uncommitted operation'}]), /snapshot rejected/);
  fail = false;
  const receipt = await new WorkspaceReceiptStore({directory}).load();
  assert.equal(receipt.before.records[0].source.getText(), 'original');
  assert.equal(receipt.after.records[0].source.getText(), 'saved operation');
  assert.equal(state.records[0].source.getText(), 'saved operation');
});
