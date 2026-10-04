import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorServiceError} from '@sharpforge/editor';
import {WorkspaceTransactionError} from '@sharpforge/workspace';
import {resourceTransactionError} from '../apps/studio/explorer-resource-errors.js';

function journalFailure({status = 'failed', mutations = [], code = 'SFEX_RESOURCE_CHANGED'} = {}) {
  const cause = new EditorServiceError(code, 'Workspace file changed before resource rename: App/Alpha.cs');
  const receipt = {version: 1, status, completedMutations: mutations};
  return new WorkspaceTransactionError('Workspace transaction failed', receipt, cause);
}

test('a stale resource failure without effects keeps its diagnostic and the exact journal evidence', () => {
  const failure = journalFailure();
  const originalCause = failure.cause;
  const diagnostic = resourceTransactionError(failure);
  assert(diagnostic instanceof EditorServiceError);
  assert.equal(diagnostic.code, 'SFEX_RESOURCE_CHANGED');
  assert.equal(diagnostic.message, originalCause.message);
  assert.equal(diagnostic.cause, failure);
  assert.equal(diagnostic.receipt, failure.receipt);
  assert.equal(diagnostic.completedMutations, failure.completedMutations);
  assert.equal(diagnostic.written, failure.written);
  assert.equal(diagnostic.committed, false);
  assert.equal(failure.code, 'SFW1110');
  assert.equal(failure.cause, originalCause);
  assert.equal(originalCause.cause, undefined);
});

test('partial, committed, unrelated and unproven resource failures retain the original journal contract', () => {
  const mutation = {kind: 'write', path: 'App/Alpha.cs'};
  const inconsistent = journalFailure();
  inconsistent.written = ['App/Alpha.cs'];
  const copiedArray = journalFailure();
  copiedArray.completedMutations = [];
  const failures = [
    journalFailure({mutations: [mutation]}),
    journalFailure({status: 'committed'}),
    journalFailure({status: 'committed-observer-failure'}),
    journalFailure({status: 'committed-adapter-failure', mutations: [mutation]}),
    journalFailure({code: 'SFEX_RESOURCE_CANCELLED'}),
    journalFailure({status: 'prepared'}),
    inconsistent,
    copiedArray,
    new EditorServiceError('SFEX_RESOURCE_CHANGED', 'Immediate validation failure')
  ];
  for (const failure of failures) assert.equal(resourceTransactionError(failure), failure);
});
