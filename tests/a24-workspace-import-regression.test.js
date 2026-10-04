import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '@sharpforge/workspace';

test('B01 import advances every URI watermark and rejects edits prepared before import', () => {
  const workspace = new Workspace();
  workspace.update('A.cs', 'class A {}', 5);
  const snapshot = workspace.exportProject();
  snapshot.files[0].text = 'class Changed {}';
  snapshot.files[0].version = 1;
  workspace.importProject(snapshot);
  assert.equal(workspace.documents.get('A.cs').source.version, 6);
  assert.equal(workspace.update('A.cs', 'stale original', 5), false);
  assert.equal(workspace.documents.get('A.cs').source.text, 'class Changed {}');
});

test('B01 removal and a later import retain the URI version watermark', () => {
  const workspace = new Workspace();
  workspace.update('A.cs', 'first', 19);
  workspace.remove('A.cs');
  workspace.importProject({format: 'sharpforge-project', version: 1, files: [{uri: 'A.cs', text: 'second'}]});
  assert.equal(workspace.documents.get('A.cs').source.version, 20);
  assert.equal(workspace.change('A.cs', [{text: 'stale'}], 19), false);
});

test('B01 malformed duplicate or oversized imports preserve all current buffers and revisions', () => {
  const workspace = new Workspace({maxDocumentLength: 10});
  workspace.update('A.cs', 'old', 5);
  const snapshot = () => workspace.exportProject();
  const before = snapshot();
  for (const files of [[{uri: 'A.cs', text: 'one'}, {uri: 'A.cs', text: 'two'}], [{uri: 'B.cs', text: 'x'.repeat(11)}]]) {
    assert.throws(() => workspace.importProject({format: 'sharpforge-project', version: 1, files}));
    assert.deepEqual(snapshot(), before);
  }
  workspace.remove('A.cs');
  assert.equal(workspace.update('A.cs', 'reopened', 1), false);
});

test('workspace document admission uses a byte budget and retains explicit count limits', () => {
  const many = new Workspace();
  for (let index = 0; index < 101; index++) many.update(`File${index}.cs`, '');
  assert.equal(many.documents.size, 101);
  const bounded = new Workspace({maxWorkspaceBytes: 10});
  bounded.update('A.cs', '12345');
  assert.throws(() => bounded.update('B.cs', '1'), /byte budget/);
  bounded.remove('A.cs');
  assert.equal(bounded.update('B.cs', '1'), true);
  const count = new Workspace({maxDocuments: 1});
  count.update('A.cs', '');
  assert.throws(() => count.update('B.cs', ''), /limit/);
});
