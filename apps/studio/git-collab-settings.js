import { GitError } from '@sharpforge/git';

const storageKey = 'sharpforge.collaboration.rooms.v1';
const maximumEntries = 32;
const identifier = /^[A-Za-z0-9_.@-]{1,128}$/;

/** Only a mounted Git repository or native root provides a stable local lookup key; preview names are never identities. */
export function collaborationWorkspaceKey(workbench, state = workbench.host.getState()) {
  if (workbench.repositoryId && workbench.workspaceBound && workbench.workspaceIdentity === workbench.host.getWorkspaceIdentity()) {
    return 'repository:' + workbench.repositoryId;
  }
  if (state.nativeMode && state.nativeWorkspace?.root) return 'native:' + state.nativeWorkspace.root;
  return null;
}

/** Scope public defaults to the exact local document as well as the stable local workspace. */
export function collaborationDocumentKey(workspace, uri) {
  return workspace ? validateKey(workspace + ':document:' + JSON.stringify(uri)) : null;
}

/** Bounded public room defaults. This store cannot accept room tokens, arbitrary secrets or document content. */
export class CollaborationRoomSettings {
  constructor({ storage, crypto = globalThis.crypto } = {}) {
    this.storage = storage;
    this.crypto = crypto;
  }

  defaults(key, { workspaceId } = {}) {
    if (key) {
      const saved = this.#read().find(entry => entry.key === key);
      if (saved) return saved.defaults;
    }
    if (workspaceId !== undefined && !identifier.test(workspaceId)) throw new GitError('Corrupt', 'Invalid repository workspace identity');
    if (workspaceId === undefined) {
      if (typeof this.crypto?.randomUUID !== 'function') throw new GitError('Unsupported', 'A secure workspace identity generator is required');
      workspaceId = this.crypto.randomUUID();
    }
    return { identity: { workspaceId }, mode: 'create' };
  }

  save(key, collaboration) {
    if (!key) return;
    validateKey(key);
    if (!this.storage) throw new GitError('Unsupported', 'Public collaboration room settings cannot be persisted in this browser');
    const identity = collaboration.identity;
    const profile = collaboration.session.presence.local;
    const signaling = collaboration.transport.signaling ?? collaboration.transport;
    const defaults = validateDefaults({
      identity, url: signaling.url, profile: { name: profile.name, color: profile.color }, mode: 'join',
      transport: collaboration.transport.signaling ? 'webrtc' : 'websocket', persistent: collaboration.session.status.persistent
    });
    const entries = this.#read().filter(entry => entry.key !== key);
    entries.push({ key, defaults });
    try { this.storage.setItem(storageKey, JSON.stringify({ version: 1, entries: entries.slice(-maximumEntries) })); }
    catch { throw new GitError('Quota', 'Public collaboration room settings could not be saved'); }
  }

  #read() {
    if (!this.storage) return [];
    let text;
    try { text = this.storage.getItem(storageKey); }
    catch { throw new GitError('Unsupported', 'Public collaboration room settings are unavailable'); }
    if (!text) return [];
    if (text.length > 256 * 1024) throw new GitError('Limit', 'Public collaboration room settings exceed their bound');
    let value;
    try { value = JSON.parse(text); }
    catch { throw new GitError('Corrupt', 'Public collaboration room settings are not valid JSON'); }
    if (value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > maximumEntries) {
      throw new GitError('Corrupt', 'Public collaboration room settings have an unsupported format');
    }
    return value.entries.map(entry => ({ key: validateKey(entry.key), defaults: validateDefaults(entry.defaults) }));
  }
}

function validateKey(key) {
  if (typeof key !== 'string' || key.length > 4096 || !/^(repository|native):[^\u0000-\u001f]+$/.test(key)) {
    throw new GitError('Corrupt', 'Invalid local collaboration workspace key');
  }
  return key;
}

function validateDefaults(value) {
  const identity = {};
  for (const field of ['workspaceId', 'roomId', 'documentId']) {
    if (!identifier.test(value?.identity?.[field] ?? '')) throw new GitError('Corrupt', 'Invalid saved collaboration room identity');
    identity[field] = value.identity[field];
  }
  let url;
  try { url = new URL(value.url); }
  catch { throw new GitError('Corrupt', 'Invalid saved collaboration server'); }
  if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash || url.href.length > 2048) {
    throw new GitError('Unsafe', 'Saved collaboration server must be an exact secure URL without credentials or queries');
  }
  const name = value.profile?.name;
  const color = value.profile?.color;
  if (typeof name !== 'string' || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name) || !/^#[0-9a-f]{6}$/i.test(color ?? '')) {
    throw new GitError('Corrupt', 'Invalid saved collaboration profile');
  }
  return { identity, url: url.href, profile: { name, color }, mode: 'join',
    transport: value.transport === 'webrtc' ? 'webrtc' : 'websocket', persistent: value.persistent !== false };
}
