import { CodeEditor } from '@sharpforge/editor';
import { createStudioCollaboration, showCollaborationSetup } from '../../apps/studio/git-collab-setup.js';
import { createStudioEditorCollaborationHost } from '../../apps/studio/git-collab-editor-host.js';
import { createDocumentEvents } from '../../apps/studio/services/documents.js';
import { applyStudioTextEdits } from '../../apps/studio/services/edits.js';

const parameters = new URLSearchParams(location.search);
const name = parameters.get('name') ?? 'Guest';
const selectedTransport = parameters.get('transport') ?? 'webrtc';
if (!['webrtc', 'websocket'].includes(selectedTransport)) throw new Error('Unknown collaboration fixture transport');
const uri = 'Program.cs';
const errors = [];
const connectionEvents = [];
const events = createDocumentEvents();
const state = { active: uri, files: [{ uri, text: parameters.get('seed') ?? '', version: 1 }],
  breakpoints: {}, dirtyFiles: new Set(), revision: 0, diskRevision: 0 };
let changeCount = 0;
let cursorCount = 0;
const originalChange = text => {
  changeCount++;
  if (state.applyingEdits) return;
  state.files[0].text = text;
  state.files[0].version++;
  events.publish(uri, text);
};
const originalCursor = () => { cursorCount++; };
const editor = new CodeEditor(document.querySelector('#source-editor'), { onChange: originalChange, onCursor: originalCursor });
editor.setModel(uri, state.files[0].text);
const editors = new Map([[uri, editor]]);
const editHost = { state, editors, documentEvents: events, remapSourceBreakpoints: () => [],
  renderWorkspace() {}, saveLocal() {}, analyze() {} };
const workbench = { host: {
  getState: () => state, getEditors: () => editors, getWorkspaceIdentity: () => 'fixture:' + (parameters.get('workspace') ?? 'workspace'),
  services: { get: service => { if (service !== 'documents') throw new Error('Unknown fixture service'); return events; } },
  applyEdits: edits => applyStudioTextEdits(editHost, edits),
  toast: message => { document.querySelector('#announcements').textContent = message; }
} };
const host = createStudioEditorCollaborationHost(workbench, editor, document.querySelector('#presence'));
const endpoint = location.origin.replace('http:', 'ws:') + '/collab';
const collaboration = await createStudioCollaboration(host, {
  identity: { workspaceId: parameters.get('workspace') ?? 'workspace', roomId: 'room', documentId: uri },
  mode: parameters.get('mode') ?? 'join', transport: selectedTransport, url: endpoint, allowInsecureLoopback: true,
  profile: { name, color: name === 'Alpha' ? '#275dad' : '#9c2a70' },
  tokenProvider: ({ identity }) => parameters.has('wrongToken') ? 'wrong-room-token' : 'test-only:'
    + JSON.stringify([identity.workspaceId, identity.roomId, identity.documentId, identity.clientId]),
  assertOrigin: url => { if (url !== endpoint) throw new Error('Fixture origin was not granted'); }
});
collaboration.session.subscribe(event => { if (event.type === 'error') errors.push(event.error.code); });
collaboration.transport.subscribe(event => {
  if (!['peer-open', 'peer-close', 'peer-error'].includes(event.type)) return;
  connectionEvents.push({ type: event.type, clientId: event.clientId, code: event.error?.code,
    diagnostics: event.diagnostics });
  if (connectionEvents.length > 64) connectionEvents.shift();
});
await collaboration.start();
let setupCancelled = null;

globalThis.collaborationFixture = {
  snapshot: () => ({
    text: collaboration.document.text, editor: editor.value, identity: collaboration.identity,
    status: collaboration.session.status, peers: collaboration.session.presence.peers,
    transport: collaboration.transport.signaling ? 'webrtc' : 'websocket',
    metrics: collaboration.transport.metrics ?? null, errors: [...errors], changeCount, cursorCount, setupCancelled,
    diagnostics: collaboration.transport.diagnostics ?? null, connectionEvents: [...connectionEvents],
    callbacksPreserved: editor.onChange === originalChange && editor.onCursor === originalCursor
  }),
  select(anchor, focus = anchor) {
    host.setSelection({ anchor, focus });
    editor.input.dispatchEvent(new Event('select'));
  },
  async edit(start, deleteCount, insertText) {
    editor.insert(insertText, start, start + deleteCount);
    await collaboration.session.whenIdle();
  },
  openSetup() {
    setupCancelled = null;
    void showCollaborationSetup(host, {
      defaults: { url: 'wss://example.test/collab', identity: { workspaceId: 'shared', roomId: 'team', documentId: uri } },
      assertOrigin: () => { throw new Error('The setup cancellation fixture may not connect'); }
    }).then(value => { setupCancelled = value === null; });
  },
  reconnect: () => collaboration.transport.reconnect(),
  async dispose() {
    await collaboration.dispose();
    host.dispose();
    editor.dispose();
    events.dispose();
  }
};
