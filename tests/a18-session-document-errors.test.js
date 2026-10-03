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
  session.status = 'Blocked source construction';
  const modes = [];
  documents.views.set('View.cs', {
    session, disposed: false, initializationFailed: true, ready: Promise.resolve(null),
    setMode: mode => modes.push(mode), panels: new Map()
  });
  await assert.rejects(documents.open('View.cs', 'design'), /Blocked source construction/);
  assert.deepEqual(modes, []);
  await documents.open('View.cs', 'code');
  assert.deepEqual(modes, ['code']);
  documents.dispose();
});
