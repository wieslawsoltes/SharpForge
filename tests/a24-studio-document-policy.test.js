import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '@sharpforge/editor';
import {DocumentService} from '../apps/studio/workbench/documents.js';
import {DocumentLocks} from '../apps/studio/workbench/document-locks.js';
import {createWorkspaceState, workspaceStateFields} from '../apps/studio/workbench/state.js';
import {studioDiskFixture} from './support/a24-studio-workspace-fixture.js';

test('execution locks include dependency projects and preserve intrinsic and recovery read-only policy', () => {
  const records = [
    {uri: 'App.cs', text: 'class App {}'}, {uri: 'Library.cs', text: 'class Library {}'},
    {uri: 'Other.cs', text: 'class Other {}'}, {uri: 'Generated.cs', text: 'class Generated {}', generated: true},
    {uri: 'Native.cs', text: 'class Native {}', readOnly: true}
  ];
  const documents = new DocumentService({records,
    createModel: record => new EditorModel(record.text, {uri: record.uri, version: record.version})});
  documents.setProjectMembership('App', ['App.cs']);
  documents.setProjectMembership('Library', ['Library.cs']);
  documents.setProjectMembership('Other', ['Other.cs']);
  const session = {id: 'running', projectId: 'App', readOnly: true,
    lastLaunch: {dependencies: [{project: 'Library', contextId: 'Library/net10.0'}]}};
  const sessions = {list: () => [session], subscribe: () => () => {}};
  const locks = new DocumentLocks(documents, sessions);
  const owner = createWorkspaceState({readOnly: false, recoveryReadOnly: false}, {documents, locks});
  try {
    assert.equal(documents.models.get('App.cs').readOnly, true);
    assert.equal(documents.models.get('Library.cs').readOnly, true);
    assert.equal(documents.models.get('Other.cs').readOnly, false);
    session.readOnly = false;
    locks.refresh();
    assert.equal(documents.models.get('Library.cs').readOnly, false);
    assert.equal(documents.models.get('Generated.cs').readOnly, true);
    assert.equal(documents.models.get('Native.cs').readOnly, true);
    documents.activate('Generated.cs');
    assert.equal(owner.state.readOnly, false, 'an intrinsic document flag does not block unrelated workspace commands');
    owner.state.recoveryReadOnly = true;
    assert.equal(owner.state.readOnly, true);
    assert.equal(documents.models.get('Other.cs').readOnly, true);
    owner.state.recoveryReadOnly = false;
    assert.equal(documents.models.get('Other.cs').readOnly, false);
    assert.equal(documents.models.get('Generated.cs').readOnly, true);
    assert(workspaceStateFields.sessions.includes('debugSourceRecords'));
    assert(workspaceStateFields.sessions.includes('debugSourceOriginals'));
  } finally {
    owner.dispose();
    locks.dispose();
    documents.dispose();
  }
});

test('closing a clean model releases it through Documents while retaining a dirty sibling model and baseline', async t => {
  const fixture = await studioDiskFixture(t, {files: [['A.cs', 'class A {}'], ['B.cs', 'class B {}']]});
  const closed = fixture.documents.models.get('A.cs');
  const sibling = fixture.documents.models.get('B.cs');
  const baseline = sibling.snapshot();
  sibling.applyEdits([{start: 0, end: 0, text: '// dirty\n'}]);
  const source = sibling.snapshot();
  fixture.documents.setTabs(['B.cs']);
  fixture.documents.activate('B.cs');
  fixture.host.releaseDocumentView = () => assert.fail('The session disposed an editor outside its document owner');
  const result = await fixture.session.closeRecord('A.cs');
  assert.equal(result.evicted, true);
  assert.equal(fixture.documents.ownsModel(closed), false);
  assert.equal(fixture.documents.get('A.cs'), null);
  assert.equal(fixture.disk.record('A.cs').lazy, true);
  assert.equal(fixture.host.context().records.find(record => record.path === 'A.cs').lazy, true);
  assert.equal(fixture.documents.models.get('B.cs'), sibling);
  assert.equal(sibling.snapshot(), source);
  assert.equal(fixture.documents.baselines.get('B.cs'), baseline);
  assert.deepEqual([...fixture.state.dirtyFiles], ['B.cs']);
});

test('a late compiler-release failure retains the committed document eviction', async t => {
  const fixture = await studioDiskFixture(t);
  fixture.documents.setTabs([]);
  const failure = new Error('Compiler release failed');
  fixture.host.releaseCompilerDocuments = async () => { throw failure; };
  await assert.rejects(fixture.session.closeRecord('A.cs'), error => error === failure && error.committed === true);
  assert.equal(fixture.documents.get('A.cs'), null);
  assert.equal(fixture.disk.record('A.cs').lazy, true);
});
