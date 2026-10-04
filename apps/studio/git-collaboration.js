import { GitError, hashBytes } from '@sharpforge/git';
import { showCollaborationSetup } from './git-collab-setup.js';
import { createStudioEditorCollaborationHost } from './git-collab-editor-host.js';
import { CollaborationRoomSettings, collaborationWorkspaceKey, collaborationDocumentKey } from './git-collab-settings.js';
import { gitElement, gitButton } from './git-dom.js';

export { sourceReplacement } from './git-collab-editor-host.js';

/** A collaboration session remains attached to its exact source document while panels are remounted. */
export class GitCollaboration {
  constructor(workbench, options = {}) {
    this.workbench = workbench;
    this.document = options.document ?? globalThis.document;
    if (!this.document) throw new GitError('Unsupported', 'Live collaboration requires a browser document');
    this.element = gitElement(this.document, 'div');
    this.setup = options.setup ?? showCollaborationSetup;
    this.createHost = options.createHost ?? createStudioEditorCollaborationHost;
    this.settings = options.settings ?? new CollaborationRoomSettings({ storage: workbench.preferences.storage });
    this.session = null;
    this.binding = null;
    this.closed = false;
    this.connecting = false;
    this.pending = null;
    this.closing = null;
    this.controller = null;
    this.unsubscribe = null;
  }

  join() {
    if (this.closed) throw new GitError('Disposed', 'Collaboration is disposed');
    if (this.connecting || this.session || this.closing) throw new GitError('Conflict', 'Disconnect the current room before joining another');
    this.connecting = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.pending = Promise.resolve().then(() => this.#join(signal));
    return this.pending;
  }

  async #join(signal) {
    const workbench = this.workbench;
    let acquired = null;
    try {
      if (signal.aborted) return;
      const state = workbench.host.getState();
      const editor = workbench.host.getEditors().get(state.active);
      const binding = this.createHost(workbench, editor, this.element);
      this.binding = binding;
      this.unsubscribe = binding.onInvalidated(error => {
        workbench.host.toast(error.message);
        this.controller?.abort();
        workbench.safe(() => this.disconnect());
      });
      const workspaceKey = collaborationWorkspaceKey(workbench, state);
      const settingsKey = collaborationDocumentKey(workspaceKey, binding.documentId);
      const saved = this.settings.defaults(settingsKey, {
        workspaceId: workspaceKey?.startsWith('repository:') ? workbench.repositoryId : undefined
      });
      const suffix = await hashBytes(new TextEncoder().encode(binding.documentId), { algorithm: 'sha256' });
      if (signal.aborted || !binding.isCurrent()) return;
      const name = binding.documentId.split('/').at(-1).replace(/[^A-Za-z0-9_.@-]/g, '-').slice(0, 80);
      acquired = await this.setup(binding, {
        signal,
        defaults: { ...saved, identity: { documentId: `${name}-${suffix.slice(0, 16)}`, ...saved.identity },
          profile: saved.profile ?? { name: workbench.preferences.model.values.userName || 'Guest' } },
        requestOriginGrant: (input, options) => this.#grant(input, options),
        assertOrigin: input => workbench.preferences.model.grants.assert(input, {
          remoteId: `collaboration:${new URL(input).origin}`, protocols: ['wss:']
        })
      });
      if (!acquired) return;
      if (signal.aborted || this.closed || !binding.isCurrent()) { await acquired.dispose(); return; }
      this.session = acquired;
      try { this.settings.save(settingsKey, acquired); }
      catch (error) { workbench.host.toast(error.message); }
      workbench.host.showPanel('git-collaboration');
    } catch (error) {
      await acquired?.dispose();
      this.session = null;
      if (!signal.aborted) throw error;
    } finally {
      if (!this.session) this.#releaseBinding();
      this.connecting = false;
      this.controller = null;
      this.pending = null;
    }
  }

  async #grant(input, { signal } = {}) {
    const url = new URL(input);
    if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash) {
      throw new GitError('Unsafe', 'Use a secure WebSocket URL without embedded credentials or queries');
    }
    const preferences = this.workbench.preferences;
    const remoteId = `collaboration:${url.origin}`;
    if (signal?.aborted) throw new GitError('Cancelled', 'Connection grant cancelled');
    if (preferences.model.grants.list(remoteId).includes(url.origin)) return;
    if (!this.document.defaultView.confirm(`Allow live collaboration to connect to ${url.origin}?`)) {
      throw new GitError('Cancelled', 'Connection grant cancelled');
    }
    await preferences.auth('grant', { remoteId, origins: [url.origin], consent: true }, { signal });
    if (signal?.aborted) throw new GitError('Cancelled', 'Connection grant cancelled');
    preferences.model.grants.grant(remoteId, [url.origin]);
    preferences.model.update({});
  }

  render(element) {
    const workbench = this.workbench;
    if (this.binding && !this.binding.isCurrent()) workbench.safe(() => this.disconnect());
    const toolbar = gitElement(this.document, 'div', { className: 'git-toolbar' },
      gitButton(this.document, 'Join Live Collaboration…', () => workbench.safe(() => this.join()), {
        disabled: !!this.session || this.connecting || !!this.closing
      }),
      gitButton(this.document, 'Disconnect', () => workbench.safe(async () => { await this.disconnect(); this.render(element); }),
        { disabled: (!this.session && !this.connecting) || !!this.closing }));
    if (!this.session && !this.connecting) this.element.replaceChildren(gitElement(this.document, 'p', {
      className: 'git-muted', text: 'Share the active source document through a collaboration server you control. Room tokens stay in this session.'
    }));
    element.replaceChildren(toolbar, this.element);
  }

  disconnect() {
    if (this.closing) return this.closing;
    this.controller?.abort();
    this.closing = this.#disconnect().finally(() => { this.closing = null; });
    return this.closing;
  }

  async #disconnect() {
    try {
      await this.pending;
      await this.session?.dispose();
    } finally {
      this.session = null;
      this.#releaseBinding();
      this.element.replaceChildren();
    }
  }

  #releaseBinding() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.binding?.dispose();
    this.binding = null;
  }

  async dispose() { this.closed = true; await this.disconnect(); }
}
