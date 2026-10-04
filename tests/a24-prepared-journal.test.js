import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceTransactionJournal, FileOperationHistory} from '@sharpforge/workspace';
import {prepared} from './support/prepared-workspace-record.js';

test('journal source budgets reject admission before any host commit', async () => {
  const record = prepared('Long.cs', 'x'.repeat(200000));
  let commits = 0;
  const journal = new WorkspaceTransactionJournal({getState: () => ({records: [], folders: []}),
    commitState() { commits++; }, limits: {maxBytes: 100}});
  await assert.rejects(journal.execute([{kind: 'create', path: record.path, record}]), /memory limit/);
  assert.equal(commits, 0);
});

test('the journal owns immutable model-free history and newer edits cannot be overwritten by undo', async () => {
  const original = prepared('Original.cs', 'original');
  const imported = prepared('New.cs', 'new');
  let state = {records: [original], folders: [], dirty: ['Original.cs'],
    documentStates: new Map([['Original.cs', {uri: 'Original.cs', source: original.source, baseline: null, dirty: true}]])};
  const journal = new WorkspaceTransactionJournal({getState: () => state, commitState(value) { state = value; }});
  const history = new FileOperationHistory(journal);
  await history.execute([{kind: 'create', path: imported.path, record: imported}]);
  const entry = history.undoStack[0];
  assert.equal(entry.before.records[0].source, original.source);
  assert.equal(entry.after.records[1].source, imported.source);
  assert.equal(entry.after.records[1].model, undefined);
  assert.equal(entry.before.documentStates.get('Original.cs').source, original.source);
  assert.equal(imported.model.disposed, false, 'the package never owns an input editor model');
  await history.undo();
  assert.deepEqual(state.records.map(record => record.path), ['Original.cs']);
  await history.redo();
  assert.equal(state.records[1].source, imported.source);
  state = {...state, records: [prepared('Original.cs', 'newer user edit'), state.records[1]]};
  await assert.rejects(history.undo(), /newer edits/);
  assert.equal(history.length, 1);
  assert.equal(original.source.statistics.textMaterialized, false);
  assert.equal(imported.source.statistics.textMaterialized, false);
});

test('rejected commits preserve owners while post-adoption failures remain committed and undoable exactly once', async () => {
  const record = prepared('Created.cs', 'created');
  let state = {records: [], folders: []};
  let reject = true;
  let finalizations = 0;
  const journal = new WorkspaceTransactionJournal({getState: () => state,
    adapter: {async apply() { return {skipped: true}; }, finalize() { finalizations++; }},
    commitState(value) {
      if (reject) throw new Error('admission denied');
      state = value;
      throw Object.assign(new Error('observer failed after adoption'), {committed: true});
    }});
  const history = new FileOperationHistory(journal);
  await assert.rejects(history.execute([{kind: 'create', path: record.path, record}]), /admission denied/);
  assert.equal(history.length, 0);
  assert.equal(state.records.length, 0);
  assert.equal(finalizations, 0);
  assert.equal(record.model.disposed, false);
  reject = false;
  await assert.rejects(history.execute([{kind: 'create', path: record.path, record}]), error => error.committed === true);
  assert.equal(history.length, 1);
  assert.equal(finalizations, 1);
  await assert.rejects(history.undo(), error => error.committed === true);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);
  assert.equal(state.records.length, 0);
  await assert.rejects(history.redo(), error => error.committed === true);
  assert.equal(history.length, 1);
  assert.equal(state.records[0].source, record.source);
  assert.equal(finalizations, 3);
});

