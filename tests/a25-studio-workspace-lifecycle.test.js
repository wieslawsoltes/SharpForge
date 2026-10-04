import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStudioEditors, studioWorkspaceIdentity } from '../apps/studio/services/editor-lifecycle.js';
import { createDocumentEvents } from '../apps/studio/services/documents.js';
import { createEditorAnnotations } from '../apps/studio/services/annotations.js';
import { GitWorkbench } from '../apps/studio/git-workbench.js';

function fixture() {
  const state = { name: 'SameName', workspaceEpoch: 7, files: [{ uri: 'Program.cs', text: 'new project' }] };
  const editor = { disposed: false, dispose() { this.disposed = true; } };
  const editors = new Map([['Program.cs', editor]]);
  const annotations = createEditorAnnotations();
  annotations.set('review', 'Program.cs', [{ message: 'Comment on the old project', start: 0, length: 1 }]);
  const documentEvents = createDocumentEvents();
  const host = { state, editors, annotations, documentEvents, navigation: { clear() {} },
    navigationButtons() {}, clearActiveEditor() {},
    docking: { host: { popouts: new Map(), contents: new Map() }, content: new Map() } };
  return { host, editor };
}

test('same-name workspace replacement retires annotations and rejects synchronization into the previously bound repository', async () => {
  const { host, editor } = fixture();
  const identity = () => studioWorkspaceIdentity(host.state, 'preview:SameName');
  const previous = identity();
  const bound = { repositoryId: 'existing-repository', workspaceBound: true, workspaceIdentity: previous,
    host: { getWorkspaceIdentity: identity, snapshot() { throw new Error('Unrelated workspace must not be read'); } } };
  const observed = [];
  host.documentEvents.subscribe(event => observed.push({ event, disposed: editor.disposed,
    annotations: host.annotations.get('Program.cs').length, identity: identity() }));
  resetStudioEditors(host);
  assert.notEqual(identity(), previous);
  assert.equal(host.editors.size, 0);
  assert.deepEqual(observed.map(record => record.event), [{ uri: 'Program.cs', text: undefined }, { type: 'reset' }]);
  assert.ok(observed.every(record => record.disposed && record.annotations === 0 && record.identity !== previous));
  await assert.rejects(GitWorkbench.prototype.synchronize.call(bound), /workspace changed/u);
  assert.equal(bound.workspaceBound, false);
});

test('recreating editors after adding source files retains repository identity but removes retired editor contributions', () => {
  const { host, editor } = fixture();
  const identity = studioWorkspaceIdentity(host.state, 'preview:SameName');
  resetStudioEditors(host, { newWorkspace: false });
  assert.equal(studioWorkspaceIdentity(host.state, 'preview:SameName'), identity);
  assert.equal(editor.disposed, true);
  assert.deepEqual(host.annotations.get('Program.cs'), []);
});

test('native reopening and empty workspaces still advance lifetime and emit an explicit reset', () => {
  const { host } = fixture();
  host.editors.clear();
  const before = studioWorkspaceIdentity(host.state, 'native:/same/folder');
  const observed = [];
  host.documentEvents.subscribe(event => observed.push(event));
  resetStudioEditors(host);
  assert.notEqual(studioWorkspaceIdentity(host.state, 'native:/same/folder'), before);
  assert.deepEqual(observed, [{ type: 'reset' }]);
  assert.deepEqual(host.annotations.get('Program.cs'), []);
});
