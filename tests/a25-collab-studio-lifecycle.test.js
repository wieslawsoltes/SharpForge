import test from 'node:test';
import assert from 'node:assert/strict';
import { CollaborationRoomSettings, collaborationWorkspaceKey, collaborationDocumentKey } from '../apps/studio/git-collab-settings.js';
import { GitCollaboration } from '../apps/studio/git-collaboration.js';
import { showCollaborationSetup } from '../apps/studio/git-collab-setup.js';
import { deferred, waitFor } from './helpers/a25-collab.js';
import { editorFixture } from './helpers/a25-collab-studio.js';

test('public room defaults are collision resistant, bounded and contain neither secrets nor source content', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  let serial = 0;
  const settings = new CollaborationRoomSettings({ storage, crypto: { randomUUID: () => 'workspace-' + ++serial } });
  const first = editorFixture();
  const second = editorFixture();
  assert.equal(collaborationWorkspaceKey(first.workbench), null);
  assert.equal(collaborationWorkspaceKey(second.workbench), null);
  assert.notEqual(settings.defaults(null).identity.workspaceId, settings.defaults(null).identity.workspaceId);
  assert.equal(settings.defaults(null, { workspaceId: 'repository-1' }).identity.workspaceId, 'repository-1');
  first.workbench.repositoryId = 'repository-1';
  first.workbench.workspaceBound = true;
  first.workbench.workspaceIdentity = first.identity;
  assert.equal(collaborationWorkspaceKey(first.workbench), 'repository:repository-1');
  first.identity = 'preview:replaced:2';
  assert.equal(collaborationWorkspaceKey(first.workbench), null, 'an unmounted repository is not a workspace identity');
  const key = collaborationDocumentKey('repository:repository-1', 'Program.cs');
  const other = collaborationDocumentKey('repository:repository-1', 'Other.cs');
  assert.notEqual(key, other);
  const publicSession = {
    identity: { workspaceId: 'shared', roomId: 'team', documentId: 'source', clientId: 'private-actor' },
    token: 'secret-token', text: 'private source contents',
    transport: { url: 'wss://example.test/collab', token: 'secret-token' },
    session: { presence: { local: { name: 'Name', color: '#123abc' } }, status: { persistent: true } }
  };
  settings.save(key, publicSession);
  const restored = new CollaborationRoomSettings({ storage });
  assert.equal(restored.defaults(key).mode, 'join');
  assert.equal(restored.defaults(key).identity.workspaceId, 'shared');
  assert.equal(restored.defaults(key).identity.clientId, undefined);
  assert.equal(settings.defaults(other).mode, 'create');
  assert.doesNotMatch([...values.values()].join(''), /secret-token|private source|private-actor/);
  for (let index = 0; index < 40; index++) settings.save('repository:repo-' + index, publicSession);
  assert.equal(JSON.parse([...values.values()][0]).entries.length, 32);
  assert.throws(() => settings.save('repository:bad', { ...publicSession, transport: { url: 'wss://example.test/?token=secret' } }),
    error => error.code === 'Unsafe');
  settings.save(null, publicSession);
  assert.equal(JSON.parse([...values.values()][0]).entries.length, 32);
});

test('disconnect waits for a pending setup and its disposal and allows no late adopted session', async () => {
  const value = editorFixture();
  const setup = deferred();
  const disposal = deferred();
  let supplied;
  let disposing = false;
  const controller = new GitCollaboration(value.workbench, {
    document: contractDocument(), createHost: () => simpleBinding(),
    settings: { defaults: () => ({ identity: { workspaceId: 'workspace' } }), save: () => assert.fail('Cancelled setup cannot save') },
    setup: async (_host, options) => { supplied = options; return setup.promise; }
  });
  const joining = controller.join();
  await waitFor(() => supplied);
  let closed = false;
  const closing = controller.dispose().then(() => { closed = true; });
  assert.equal(supplied.signal.aborted, true);
  setup.resolve({ dispose: async () => { disposing = true; await disposal.promise; } });
  await waitFor(() => disposing);
  assert.equal(closed, false);
  disposal.resolve();
  await Promise.all([joining, closing]);
  assert.equal(controller.session, null);
  assert.equal(controller.connecting, false);
  assert.throws(() => controller.join(), error => error.code === 'Disposed');
});

test('setup cancellation clears the password immediately and awaits late construction cleanup', async () => {
  const document = contractDocument();
  const abort = new AbortController();
  const constructing = deferred();
  const disposing = deferred();
  let options;
  let disposalStarted = false;
  let finished = false;
  const result = showCollaborationSetup({ element: document.createElement('div') }, {
    signal: abort.signal, createCollaboration: async (_host, supplied) => { options = supplied; return constructing.promise; }
  }).then(value => { finished = true; return value; });
  const dialog = document.body.children[0];
  const form = dialog.children.find(child => child.tag === 'form');
  const password = descendants(form).find(child => child.type === 'password');
  password.value = 'room-secret';
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await waitFor(() => options);
  abort.abort();
  assert.equal(password.value, '');
  assert.equal(await options.tokenProvider(), '');
  constructing.resolve({ start: () => assert.fail('Cancelled setup must not connect'),
    dispose: async () => { disposalStarted = true; await disposing.promise; } });
  await waitFor(() => disposalStarted);
  assert.equal(finished, false);
  disposing.resolve();
  assert.equal(await result, null);
  assert.equal(document.body.children.length, 0);
});

function simpleBinding() {
  return { documentId: 'Program.cs', isCurrent: () => true, onInvalidated: () => () => {}, dispose() {} };
}

// A dialog contract fixture exercises orchestration only; native DOM/layout are qualified in a25_collab_browser.py.
function contractDocument() {
  const document = { createElement: tag => new ContractElement(document, tag), activeElement: { focus() {} } };
  document.body = document.createElement('body');
  return document;
}

class ContractElement extends EventTarget {
  constructor(document, tag) {
    super();
    Object.assign(this, { ownerDocument: document, tag, nodeType: 1, children: [], value: '', disabled: false });
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute() {}
  focus() {}
  showModal() {}
  close() {}
  reportValidity() { return true; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
}

function descendants(element) { return element.children.flatMap(child => [child, ...descendants(child)]); }
