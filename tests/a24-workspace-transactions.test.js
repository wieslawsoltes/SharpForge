import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WorkspaceTransactionJournal, FileOperationHistory, hashWorkspaceBytes} from '@sharpforge/workspace';

function workspace(options = {}) {
  let state = {records: [{path: 'A.cs', text: 'class A {}'}, {path: 'data.bin', bytes: Uint8Array.of(0, 255, 17)}],
    folders: ['Empty'], tabs: ['A.cs']};
  const journal = new WorkspaceTransactionJournal({
    getState: () => state,
    commitState: next => { state = next; },
    ...options,
  });
  return {journal, read: () => state, replace: value => { state = value; }};
}

test('workspace transaction validates the complete plan before committing one memory state', async () => {
  const stored = [];
  const session = workspace({store: {save: receipt => stored.push(structuredClone(receipt))}});
  const transaction = session.journal.begin({label: 'Move source and preserve binary'});
  transaction.add({kind: 'write', path: 'A.cs', text: 'class A { public int Value => 42; }'});
  transaction.add({kind: 'move', path: 'data.bin', destination: 'Empty/data.bin'});
  const receipt = await transaction.commit();
  assert.equal(receipt.status, 'committed');
  assert.deepEqual(session.read().records.find(file => file.path === 'Empty/data.bin').bytes, Uint8Array.of(0, 255, 17));
  assert.ok(receipt.operations[0].beforeHash !== receipt.operations[0].afterHash);
  assert.equal(stored[0].status, 'prepared');
  assert.equal(stored.at(-1).status, 'committed');
  assert.throws(() => transaction.add({kind: 'delete', path: 'A.cs'}), /no longer open/i);
});

test('a third disk mutation failure reports exact completed operations and preserves all unsaved memory', async () => {
  let count = 0;
  const session = workspace({adapter: {async apply() { if (++count === 3) throw new Error('injected third disk write'); }}});
  const before = structuredClone(session.read());
  await assert.rejects(session.journal.execute([
    {kind: 'create', path: 'One.cs', text: 'class One {}'},
    {kind: 'create', path: 'Two.cs', text: 'class Two {}'},
    {kind: 'create', path: 'Three.cs', text: 'class Three {}'},
  ]), error => {
    assert.equal(error.code, 'SFW1110');
    assert.deepEqual(error.completedMutations.map(operation => operation.path), ['One.cs', 'Two.cs']);
    assert.equal(error.receipt.status, 'failed');
    return true;
  });
  assert.deepEqual(session.read(), before);
});

test('collision, stale hash and cancellation reject a plan before any disk mutation', async () => {
  let applied = 0;
  const session = workspace({adapter: {apply() { applied++; }}});
  await assert.rejects(session.journal.execute([{kind: 'create', path: 'a.cs', text: 'bad'}]), /collid|exists/i);
  await assert.rejects(session.journal.execute([{kind: 'write', path: 'A.cs', text: 'bad', expectedHash: '0'.repeat(64)}]),
    /changed/i);
  const aborted = AbortSignal.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(session.journal.execute([{kind: 'delete', path: 'A.cs'}], {signal: aborted}), {name: 'AbortError'});
  assert.equal(applied, 0);
  session.journal.dispose();
  assert.throws(() => session.journal.begin(), /disposed/i);
});

test('history undo/redo restores binary bytes and refuses to overwrite a newer buffer', async () => {
  const session = workspace();
  const initial = structuredClone(session.read());
  const history = new FileOperationHistory(session.journal);
  await history.execute([{kind: 'move', path: 'data.bin', destination: 'Empty/moved.bin'}]);
  await history.undo();
  assert.deepEqual(session.read(), initial);
  await history.redo();
  assert.ok(session.read().records.some(file => file.path === 'Empty/moved.bin'));
  session.read().records[0].text = '// independent edit';
  await assert.rejects(history.undo(), /newer edits/i);
  assert.equal(session.read().records[0].text, '// independent edit');
});

test('history capacity bounds retained snapshots while preserving the latest valid inverse', async () => {
  const session = workspace();
  const history = new FileOperationHistory(session.journal, {maxEntries: 1});
  await history.execute([{kind: 'write', path: 'A.cs', text: 'first'}]);
  await history.execute([{kind: 'write', path: 'A.cs', text: 'second'}]);
  await history.undo();
  assert.equal(session.read().records[0].text, 'first');
  await assert.rejects(history.undo(), /No file operation/i);
  assert.equal(await hashWorkspaceBytes(Uint8Array.of(0, 255)),
    createHash('sha256').update(Uint8Array.of(0, 255)).digest('hex'));
});
