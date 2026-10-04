import {
  SequenceCrdt, CollabSession, IndexedDbCollaborationPersistence, MemoryCollaborationPersistence,
  WebSocketCollabTransport, WebRtcCollabTransport, acquireCollaborationClient, GitError
} from '@sharpforge/git';
import { createCollaborationPresence } from './git-collab-presence.js';

/** Compose the production collaboration components from host-owned identity, grants and credentials. */
export async function createStudioCollaboration(host, options) {
  const identity = { ...options.identity };
  let clientLease = null;
  if (!identity.clientId) {
    clientLease = await acquireCollaborationClient({ ...identity, storage: options.identityStorage, locks: options.locks, crypto: options.crypto });
    identity.clientId = clientLease.clientId;
  }
  let document;
  let persistence;
  let transport;
  let session;
  try {
    document = new SequenceCrdt({ ...identity, actorId: identity.clientId, limits: options.limits });
    persistence = options.persistence ?? (options.persistent === false
      ? new MemoryCollaborationPersistence({ limits: options.limits })
      : new IndexedDbCollaborationPersistence({ databaseName: options.databaseName, indexedDB: options.indexedDB, limits: options.limits }));
    const signaling = new WebSocketCollabTransport({
      identity, url: options.url, tokenProvider: options.tokenProvider, assertOrigin: options.assertOrigin,
      allowInsecureLoopback: options.allowInsecureLoopback, WebSocket: options.WebSocket, limits: options.limits
    });
    transport = signaling;
    if (options.transport === 'webrtc') transport = new WebRtcCollabTransport({
      signaling, RTCPeerConnection: options.RTCPeerConnection, rtcConfiguration: options.rtcConfiguration,
      assertIceServer: options.assertIceServer, limits: options.limits
    });
    session = new CollabSession({
      document, transport, persistence, profile: options.profile, ownDocument: true,
      ownPersistence: !options.persistence, identity, maxPending: options.maxPending,
      initializeText: options.mode === 'join' ? undefined : options.initializeText ?? host.getText?.() ?? ''
    });
    const view = createCollaborationPresence(host, { session });
    let disposal = null;
    return Object.freeze({
      document, session, transport, view, identity,
      start: () => session.start(),
      dispose() {
        disposal ??= (async () => {
          view.dispose();
          try { await session.dispose(); }
          finally { clientLease?.release(); }
        })();
        return disposal;
      }
    });
  } catch (error) {
    if (session) await session.dispose();
    else {
      transport?.dispose();
      document?.dispose();
      if (!options.persistence) persistence?.dispose();
    }
    clientLease?.release();
    throw error;
  }
}

/** Display a concrete room setup dialog. Grants must be supplied by the host's permission service. */
export function showCollaborationSetup(host, options = {}) {
  const document = host.element?.ownerDocument;
  if (!document) throw new TypeError('Collaboration setup requires a host element');
  if (options.signal?.aborted) return Promise.resolve(null);
  const previousFocus = document.activeElement;
  const defaults = options.defaults ?? {};
  const dialog = document.createElement('dialog');
  dialog.className = 'git-collab-setup';
  dialog.setAttribute('aria-label', 'Join live collaboration');
  const heading = document.createElement('h2');
  heading.textContent = 'Join live collaboration';
  const form = document.createElement('form');
  const server = field(document, form, 'Server', 'url', defaults.url ?? '', 'wss://collaboration.example.com/collab');
  const workspace = field(document, form, 'Workspace', 'text', defaults.identity?.workspaceId ?? host.workspaceId ?? 'workspace');
  const room = field(document, form, 'Room', 'text', defaults.identity?.roomId ?? 'team');
  const source = field(document, form, 'Document', 'text', defaults.identity?.documentId ?? host.documentId ?? 'Program.cs');
  const name = field(document, form, 'Display name', 'text', defaults.profile?.name ?? 'Guest');
  const token = options.tokenProvider ? null : field(document, form, 'Room token', 'password', '');
  if (token) { token.autocomplete = 'off'; token.spellcheck = false; }
  for (const input of [workspace, room, source]) {
    input.pattern = '[A-Za-z0-9_.@-]{1,128}';
    input.maxLength = 128;
  }
  const persistent = checkbox(document, form, 'Keep edits available offline', defaults.persistent !== false);
  const direct = checkbox(document, form, 'Use direct peer connections', defaults.transport === 'webrtc');
  const create = checkbox(document, form, 'Create room from current document; fail if the room already contains another document', defaults.mode !== 'join');
  const joinNotice = document.createElement('p');
  joinNotice.textContent = 'Joining an existing room replaces this editor with the shared document. Creating a room preserves your current text.';
  form.append(joinNotice);
  const error = document.createElement('p');
  error.className = 'git-collab-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'git-collab-setup-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const join = document.createElement('button');
  join.type = 'submit';
  join.textContent = 'Join';
  actions.append(cancel, join);
  form.append(error, actions);
  dialog.append(heading, form);
  document.body.append(dialog);

  return new Promise((resolve, reject) => {
    let completed = false;
    let secret = '';
    let collaboration = null;
    let submission = Promise.resolve();
    const controller = new AbortController();
    function closeDialog() {
      if (token) token.value = '';
      options.signal?.removeEventListener('abort', cancelSetup);
      dialog.close?.();
      dialog.remove();
      previousFocus?.focus();
    }
    function cancelSetup() {
      if (completed) return;
      completed = true;
      secret = '';
      controller.abort();
      closeDialog();
      Promise.all([submission, collaboration?.dispose()]).then(() => resolve(null), reject);
    }
    async function submit() {
      try {
        if (completed) return;
        if (options.requestOriginGrant) await options.requestOriginGrant(server.value, { signal: controller.signal });
        if (completed) return;
        secret = token?.value ?? '';
        collaboration = await (options.createCollaboration ?? createStudioCollaboration)(host, {
          ...defaults, ...options,
          identity: {
            workspaceId: workspace.value, roomId: room.value, documentId: source.value,
            clientId: defaults.identity?.clientId
          },
          url: server.value, profile: { name: name.value, color: defaults.profile?.color ?? '#3b82f6' },
          persistent: persistent.checked, transport: direct.checked ? 'webrtc' : 'websocket',
          mode: create.checked ? 'create' : 'join',
          tokenProvider: options.tokenProvider ?? (() => Promise.resolve(secret))
        });
        if (completed) { await collaboration.dispose(); return; }
        await collaboration.start();
        if (completed) { await collaboration.dispose(); return; }
        const original = collaboration;
        completed = true;
        closeDialog();
        resolve(Object.freeze({ ...original, async dispose() { secret = ''; await original.dispose(); } }));
      } catch (failure) {
        secret = '';
        await collaboration?.dispose();
        collaboration = null;
        if (completed) return;
        error.textContent = failure instanceof GitError ? failure.message : 'The collaboration session could not be opened.';
        error.hidden = false;
        join.disabled = false;
      }
    }
    cancel.addEventListener('click', cancelSetup);
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancelSetup(); });
    options.signal?.addEventListener('abort', cancelSetup, { once: true });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (completed || join.disabled || !form.reportValidity()) return;
      join.disabled = true;
      error.hidden = true;
      submission = Promise.resolve().then(submit);
      void submission.catch(reject);
    });
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    server.focus();
  });
}

function field(document, form, labelText, type, value, placeholder = '') {
  const label = document.createElement('label');
  const text = document.createElement('span');
  text.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  input.required = true;
  label.append(text, input);
  form.append(label);
  return input;
}

function checkbox(document, form, text, checked) {
  const label = document.createElement('label');
  label.className = 'git-collab-checkbox';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  const name = document.createElement('span');
  name.textContent = text;
  label.append(input, name);
  form.append(label);
  return input;
}
