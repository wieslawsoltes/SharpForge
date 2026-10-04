import { createCollaborationEditorBinding } from './git-collab-binding.js';

/** Accessible presence contribution. The host owns session creation, credentials, editor and mounting. */
export function createCollaborationPresence(host, { session }) {
  const document = host.element?.ownerDocument;
  if (!document) throw new TypeError('Collaboration presence requires a host element');
  let disposed = false;
  const root = document.createElement('section');
  root.className = 'git-collab-presence';
  root.setAttribute('aria-label', 'Live collaboration');
  const header = document.createElement('div');
  header.className = 'git-collab-presence-header';
  const title = document.createElement('strong');
  title.textContent = 'Live collaboration';
  const state = document.createElement('span');
  state.className = 'git-collab-state';
  state.setAttribute('role', 'status');
  const detail = document.createElement('p');
  detail.className = 'git-collab-detail';
  const peers = document.createElement('ul');
  peers.className = 'git-collab-peers';
  peers.setAttribute('aria-label', 'People in this document');
  const empty = document.createElement('p');
  empty.className = 'git-collab-detail';
  empty.textContent = 'You are the only person here.';
  const error = document.createElement('p');
  error.className = 'git-collab-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'git-collab-retry';
  retry.textContent = 'Reconnect';
  retry.addEventListener('click', retryConnection);
  header.append(title, state);
  root.append(header, detail, peers, empty, error, retry);
  host.element.append(root);
  const peerNodes = new Map();
  const binding = createCollaborationEditorBinding(host, session);

  function renderStatus(status = session.status) {
    const labels = {
      idle: 'Offline', connecting: 'Connecting…', authenticating: 'Joining…', reconnecting: 'Reconnecting…',
      blocked: 'Connection needs attention', synchronized: 'Connected', disposed: 'Disconnected', open: 'Syncing…'
    };
    state.textContent = labels[status.state] ?? 'Syncing…';
    root.dataset.state = status.state;
    if (status.storageError) detail.textContent = 'The local collaboration journal needs attention; some changes may not be available after reload.';
    else if (status.unsaved) detail.textContent = status.unsaved + ' edit(s) are not saved locally.';
    else if (status.pending) detail.textContent = status.pending + ' edit(s) saved locally, waiting to sync.';
    else detail.textContent = status.persistent ? 'All edits saved on this device.' : 'Edits are held in this session only.';
    retry.textContent = status.unsaved || status.storageError ? 'Retry saving' : 'Reconnect';
    retry.hidden = status.synchronized && !status.unsaved && !status.storageError;
    retry.disabled = status.state === 'disposed';
    if (!status.unsaved && !status.storageError && status.synchronized) error.hidden = true;
  }

  function renderPeers(values = session.presence.peers) {
    const active = new Set(values.map(peer => peer.clientId));
    for (const [clientId, node] of peerNodes) {
      if (!active.has(clientId)) { node.remove(); peerNodes.delete(clientId); }
    }
    for (const peer of values) {
      let item = peerNodes.get(peer.clientId);
      if (!item) {
        item = document.createElement('li');
        const swatch = document.createElement('span');
        swatch.className = 'git-collab-avatar';
        swatch.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'git-collab-name';
        const activity = document.createElement('span');
        activity.className = 'git-collab-activity';
        item.append(swatch, name, activity);
        peers.append(item);
        peerNodes.set(peer.clientId, item);
      }
      item.children[0].textContent = (peer.name || peer.clientId).slice(0, 1).toUpperCase();
      item.children[0].style.backgroundColor = peer.color;
      item.children[1].textContent = peer.name || peer.clientId;
      item.children[2].textContent = peer.state === 'idle' ? 'Away' : 'Editing';
    }
    empty.hidden = values.length > 0;
  }

  function showError(failure) {
    if (disposed) return;
    error.hidden = false;
    error.textContent = failure.message;
    retry.hidden = false;
    host.announce?.(failure.message);
  }

  async function retryConnection() {
    retry.disabled = true;
    try {
      if (session.status.unsaved || session.status.storageError) await session.retryPendingPersistence();
      else session.transport.reconnect();
    } catch (failure) {
      showError(failure);
    } finally {
      if (!disposed) retry.disabled = false;
    }
  }

  const unsubscribe = session.subscribe(event => {
    if (event.type === 'presence') renderPeers(event.peers);
    else if (event.type === 'state') renderStatus(event.status);
    else if (event.type === 'error') showError(event.error);
  });
  renderStatus();
  renderPeers();
  return Object.freeze({
    element: root,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      binding.dispose();
      retry.removeEventListener('click', retryConnection);
      peerNodes.clear();
      root.remove();
    }
  });
}
