import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignerDocuments} from '../apps/studio/designer-documents.js';

function host() {
  const text = 'class View { static Window Create() { return new Window(); } }';
  return new DesignerDocuments({
    state: {active: 'View.cs', files: [{uri: 'View.cs', text}]},
    createTools: () => { throw new Error('Unexpected host construction'); },
    openSource: () => {}, onError: () => {}
  });
}

test('failed source initialization keeps Code accessible without exposing the placeholder design', async () => {
  const documents = host();
  const session = documents.registry.open('View.cs');
  const failure = new Error('Blocked source construction');
  session.status = failure.message;
  const modes = [];
  const reports = [];
  const failures = [];
  let attempts = 0;
  documents.onError = error => failures.push(error);
  documents.views.set('View.cs', {
    session, disposed: false, initializationFailed: true, ready: Promise.resolve(null),
    tools: {sourceSync: {
      // Opening a failed view retries its actual source initialization contract.
      connect: async uri => { assert.equal(uri, 'View.cs'); attempts++; throw failure; },
      report: (state, message) => reports.push({state, message})
    }},
    setMode: mode => modes.push(mode), panels: new Map()
  });
  await assert.rejects(documents.open('View.cs', 'design'), /Blocked source construction/);
  assert.deepEqual(modes, []);
  assert.equal(session.viewState.mode, 'code');
  assert.deepEqual(failures, [failure]);
  await documents.open('View.cs', 'code');
  assert.deepEqual(modes, ['code']);
  assert.equal(attempts, 2);
  assert.deepEqual(failures, [failure, failure]);
  assert.deepEqual(reports, Array.from({length: 2}, () => ({state: 'blocked', message: failure.message})));
  documents.dispose();
});
