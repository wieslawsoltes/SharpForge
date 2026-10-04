import { GitError, GitWorkerClient } from '@sharpforge/git';
import { decodeWorkspaceFile, encodeWorkspaceFile } from '@sharpforge/archive';
import { gitDialog } from './git-dom.js';
import { renderGitChanges } from './git-changes.js';
import { renderGitRepository } from './git-history-view.js';
import { renderGitDiff } from './git-diff.js';
import { renderGitMerge } from './git-merge-editor.js';
import { renderGitProviders } from './git-provider-view.js';
import { renderGitSnapshot } from './git-snapshot.js';
import { GitPreferences, renderGitSettings } from './git-preferences.js';
import { decorateGitExplorer } from './git-explorer-overlay.js';
import { showGitCloneDialog } from './git-clone-dialog.js';
import { showGitBranchPicker, showCreateGitBranch, showMergeGitBranch } from './git-branch-picker.js';
import { updateGitStatus } from './git-status-bar.js';
import { createGitBlameMargin } from './git-blame-margin.js';
import { GitCollaboration } from './git-collaboration.js';
import { renderGitRepositoryTools } from './git-repository-tools.js';
import { withGitWorkspaceLoad, checkGitWorkspaceLoad, cancelGitWorkspaceLoad } from './git-workspace-load.js';
import { adoptGitWorkspace } from './git-workspace-adoption.js';

const panels = new Map([
  ['git-changes', renderGitChanges], ['git-repository', renderGitRepository],
  ['git-diff', renderGitDiff], ['git-merge', renderGitMerge], ['git-providers', renderGitProviders],
  ['git-snapshot', renderGitSnapshot], ['git-maintenance', renderGitRepositoryTools]
]);

/** One workbench routes operations for several repositories through a dedicated worker. */
export class GitWorkbench {
  constructor(host) {
    this.host = host;
    this.worker = new Worker(new URL('./git-worker.js', import.meta.url), { type: 'module' });
    this.client = new GitWorkerClient(this.worker);
    this.repositoryId = null;
    this.repositories = new Map();
    this.mounts = new Map();
    this.synced = new Map();
    this.changes = [];
    this.allChanges = [];
    this.busy = false;
    this.progress = null;
    this.selection = null;
    this.generation = 0;
    this.closed = false;
    this.workspaceBound = false;
    this.credentialIds = new Map();
    this.preferences = new GitPreferences(this);
    for (const item of this.preferences.readRepositories()) this.repositories.set(item.repositoryId, { ...item, open: false });
    this.ready = this.preferences.restoreGrants();
    this.ready.catch(error => this.host.toast(error?.message ?? String(error), 'error'));
    this.collaboration = new GitCollaboration(this);
    this.explorerObserver = new MutationObserver(() => this.decorateExplorer());
    const tree = document.getElementById('file-tree');
    if (tree) this.explorerObserver.observe(tree, { childList: true, subtree: true });
  }

  async request(method, params = {}, options = {}) {
    await this.ready;
    if (['checkout', 'merge', 'rebase', 'cherryPick', 'revert', 'stash', 'reset', 'restore',
      'resolveConflictChoice', 'revertComparisonSelection', 'configureSparseCheckout', 'lfsFetch',
      'initializeSubmodules', 'importZip', 'importBundle'].includes(method)) {
      this.assertWorktreeChange();
      checkGitWorkspaceLoad(options);
    }
    const requestOptions = { ...options };
    delete requestOptions.workspaceLoad;
    return this.client.request(method, { repositoryId: this.repositoryId ?? 'default', ...params }, requestOptions);
  }

  assertWorktreeChange() {
    if (this.collaboration?.session || this.collaboration?.connecting) {
      throw new Error('Disconnect live collaboration before replacing files or changing the Git worktree.');
    }
  }

  async run(action, { workspace = false, workspaceLoad } = {}) {
    if (this.busy) throw new Error('Wait for the current Git operation or cancel it.');
    this.busy = true;
    this.generation = (this.generation ?? 0) + 1;
    this.refreshController?.abort();
    for (const { state } of this.mounts.values()) state.renderController?.abort();
    const controller = this.controller = new AbortController();
    this.updateStatus('Working…');
    for (const button of document.querySelectorAll('[data-git-cancel]')) button.disabled = false;
    let result;
    let failed = false;
    let failure;
    let refreshed = false;
    try {
      const options = { signal: controller.signal, workspaceLoad, onProgress: event => {
        this.progress = event;
        this.updateStatus(event.message ?? `${event.phase ?? 'Git'} ${event.completed ?? ''}`);
      } };
      const invoke = async context => {
        await this.ready;
        checkGitWorkspaceLoad(context);
        return action(context);
      };
      result = workspace || workspaceLoad ? await withGitWorkspaceLoad(this.host, options, invoke) : await invoke(options);
    } catch (error) { failed = true; failure = error; }
    try {
      refreshed = await this.refresh({ render: false, operation: controller }) !== false;
    } catch (error) {
      if (failed) {
        const combined = new AggregateError([failure, error], 'Git operation and status refresh failed');
        if (failure?.committed || error?.committed) combined.committed = true;
        failure = combined;
      } else { failed = true; failure = error; }
    } finally {
      this.busy = false;
      this.progress = null;
      this.controller = null;
      this.updateStatus();
      if (refreshed) await this.safe(() => this.renderMounted());
    }
    if (failed) throw failure;
    return result;
  }

  safe(action) {
    return Promise.resolve().then(action).catch(error => this.host.toast(error?.message ?? String(error), 'error'));
  }

  updateStatus(message) {
    updateGitStatus(this.host.gitIndicator, this, message);
  }

  async synchronize(options = {}) {
    if (!this.repositoryId || !this.workspaceBound) return;
    if (this.workspaceIdentity !== this.host.getWorkspaceIdentity()) {
      this.workspaceBound = false;
      throw new Error('The workspace changed. Reopen the matching Git repository before synchronizing files.');
    }
    const files = [];
    const current = new Set();
    for (const file of this.host.snapshot()) {
      const path = file.path ?? file.uri;
      const data = encodeWorkspaceFile({ ...file, path });
      current.add(path);
      const previous = this.synced.get(path);
      if (previous?.length === data.length && previous.every((byte, index) => byte === data[index])) continue;
      files.push({ path, data, mode: file.mode });
    }
    const removePaths = [...this.synced.keys()].filter(path => !current.has(path));
    if (!files.length && !removePaths.length) return;
    await this.request('syncFiles', { files, removePaths }, options);
    for (const file of files) this.synced.set(file.path, file.data);
    for (const path of removePaths) this.synced.delete(path);
  }

  async refresh({ render = true, operation } = {}) {
    if (this.closed || this.busy && operation !== this.controller) return false;
    if (!this.repositoryId) {
      if (render) await this.renderMounted();
      return true;
    }
    this.refreshController?.abort();
    const controller = this.refreshController = new AbortController();
    const generation = this.generation ?? 0;
    const repositoryId = this.repositoryId;
    const current = () => !this.closed && controller === this.refreshController && generation === (this.generation ?? 0)
      && repositoryId === this.repositoryId && (!this.busy || operation === this.controller);
    const options = { signal: controller.signal };
    let reading = true;
    try {
      await this.synchronize(options);
      if (!current()) return false;
      const allChanges = await this.request('status', { repositoryId, ignored: true }, options);
      if (!current()) return false;
      const head = await this.request('head', { repositoryId }, options);
      if (!current()) return false;
      let aheadBehind;
      try { aheadBehind = await this.request('aheadBehind', { repositoryId }, options); }
      catch (error) {
        if (!['NotFound', 'Conflict'].includes(error?.code)) throw error;
        aheadBehind = null;
      }
      if (!current()) return false;
      reading = false;
      if (this.headOid !== head.oid) {
        await this.blameMargin?.refresh(head.oid ?? 'HEAD');
        if (!current()) return false;
        const annotations = this.reviewAnnotations;
        await annotations?.dispose();
        if (!current()) return false;
        if (this.reviewAnnotations === annotations) this.reviewAnnotations = null;
      }
      this.allChanges = allChanges;
      this.changes = allChanges.filter(change => change.kind !== 'ignored');
      this.branch = head.ref.startsWith('refs/heads/') ? head.ref.slice(11) : head.oid?.slice(0, 8) ?? 'unborn';
      this.headOid = head.oid;
      this.aheadBehind = aheadBehind;
      this.updateStatus();
      this.decorateExplorer();
      if (render && current()) await this.renderMounted();
      return true;
    } catch (error) {
      if (!reading || current()) throw error;
      return false;
    } finally {
      if (this.refreshController === controller) this.refreshController = null;
    }
  }

  async render(id, element, state = {}) {
    if (this.closed) return;
    const generation = state.gitGeneration = (state.gitGeneration ?? 0) + 1;
    this.mounts.set(id, { element, state });
    state.renderController?.abort();
    // Workspace adoption can synchronously ask the shell to render before the operation refreshes status.
    if (this.busy) return;
    const operationGeneration = this.generation ?? 0;
    const repositoryId = this.repositoryId;
    const usesSelection = id === 'git-merge' || id === 'git-diff';
    const selection = this.selection;
    const controller = state.renderController = new AbortController();
    const current = () => !this.closed && !this.busy && state.gitMounted !== false && generation === state.gitGeneration
      && operationGeneration === (this.generation ?? 0) && repositoryId === this.repositoryId
      && (!usesSelection || selection === this.selection);
    const render = async () => {
      try {
        if (!current()) return;
        const previous = state.dispose;
        state.dispose = null;
        await previous?.();
        if (!current()) return;
        element.classList.add('git-tool');
        const renderer = id === 'git-settings' ? renderGitSettings : id === 'git-collaboration'
          ? target => this.collaboration.render(target) : panels.get(id);
        if (!renderer) throw new Error(`Unknown Git panel: ${id}`);
        let dispose;
        try { dispose = await renderer(element, this, { controller, isCurrent: current }); }
        catch (error) {
          controller.abort();
          if (current()) throw error;
          return;
        }
        if (!current()) await dispose?.();
        else state.dispose = dispose;
      } finally {
        if (state.renderController === controller) state.renderController = null;
      }
    };
    state.rendering = (state.rendering ?? Promise.resolve()).then(render, render);
    return state.rendering;
  }

  async renderMounted() {
    for (const [id, { element, state }] of this.mounts) {
      if (element.isConnected && state.gitMounted !== false) await this.render(id, element, state);
    }
  }

  initDialog() {
    return gitDialog(document, {
      title: 'Initialize Repository', submitLabel: 'Initialize',
      fields: [
        { name: 'name', label: 'Repository name', value: this.host.getState().name, required: true },
        { name: 'defaultBranch', label: 'Default branch', value: this.preferences.model.values.defaultBranch, required: true },
        { name: 'algorithm', label: 'Object format', value: 'sha1', options: [{ value: 'sha1', label: 'SHA-1' }, { value: 'sha256', label: 'SHA-256' }] }
      ],
      onSubmit: values => this.run(async options => {
        const repositoryId = `repo-${crypto.randomUUID()}`;
        const opened = await this.request('init', { ...values, repositoryId, backend: 'indexeddb' }, options);
        this.rememberRepository(opened);
        checkGitWorkspaceLoad(options);
        const files = this.host.snapshot().map(file => ({ path: file.path ?? file.uri,
          data: encodeWorkspaceFile({ ...file, path: file.path ?? file.uri }), mode: file.mode }));
        await this.request('syncFiles', { repositoryId, files }, options);
        checkGitWorkspaceLoad(options);
        this.repositoryId = repositoryId;
        this.bindWorkspace(files);
        await this.applyIdentity(options);
        this.host.showPanel('git-changes');
      }, { workspace: true })
    });
  }

  async openDirectory() {
    this.assertWorktreeChange();
    this.confirmWorkspaceReplacement();
    if (this.busy) throw new Error('Wait for the current Git operation or cancel it.');
    return withGitWorkspaceLoad(this.host, {}, async loadOptions => {
      const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
      checkGitWorkspaceLoad(loadOptions);
      await this.run(async options => {
        const repositoryId = `repo-${crypto.randomUUID()}`;
        const opened = await this.request('open', { repositoryId, directory, name: directory.name }, options);
        this.rememberRepository(opened);
        checkGitWorkspaceLoad(options);
        await this.adoptRepository(options, { openWorkspace: true, repositoryId });
        this.host.showPanel('git-changes');
      }, { workspaceLoad: loadOptions.workspaceLoad });
    });
  }

  cloneDialog() { return showGitCloneDialog(this); }

  async adoptRepository(options = {}, { openWorkspace = false, repositoryId = this.repositoryId } = {}) {
    return withGitWorkspaceLoad(this.host, options, async context => {
      this.assertWorktreeChange();
      const previousRepository = this.repositoryId;
      const files = await this.request('files', { repositoryId }, context);
      checkGitWorkspaceLoad(context);
      if (previousRepository !== this.repositoryId) throw new GitError('Conflict', 'The selected Git repository changed while reading its files.');
      const records = files.map(file => ({ ...decodeWorkspaceFile(file.path, file.data), mode: file.mode }));
      this.blameMargin?.dispose();
      this.blameMargin = null;
      await this.reviewAnnotations?.dispose();
      this.reviewAnnotations = null;
      checkGitWorkspaceLoad(context);
      if (previousRepository !== this.repositoryId) throw new GitError('Conflict', 'The selected Git repository changed while preparing its files.');
      return adoptGitWorkspace(this, records, context, { openWorkspace, name: this.repositories.get(repositoryId)?.name }, () => {
        this.repositoryId = repositoryId;
        this.providerSnapshot = null;
        this.changes = [];
        this.allChanges = [];
        this.branch = null;
        this.bindWorkspace(files);
      });
    });
  }

  async applyResolvedFile(result, options = {}) {
    return withGitWorkspaceLoad(this.host, options, async context => {
      const repositoryId = this.repositoryId;
      const wasBound = this.workspaceBound;
      const records = this.host.snapshot().filter(file => (file.path ?? file.uri) !== result.path);
      let file;
      if (!result.deleted) {
        file = await this.request('readFile', { path: result.path, repositoryId }, context);
        records.push({ ...decodeWorkspaceFile(result.path, file.data), mode: file.mode });
      }
      checkGitWorkspaceLoad(context);
      if (repositoryId !== this.repositoryId) throw new GitError('Conflict', 'The selected Git repository changed while resolving a file.');
      return adoptGitWorkspace(this, records, context, {}, () => {
        if (file) this.synced.set(result.path, file.data);
        else this.synced.delete(result.path);
        this.workspaceIdentity = this.host.getWorkspaceIdentity();
        this.workspaceBound = wasBound;
      });
    });
  }

  bindWorkspace(files) {
    this.synced = new Map(files.map(file => [file.path, file.data]));
    this.workspaceIdentity = this.host.getWorkspaceIdentity();
    this.workspaceBound = true;
  }

  rememberRepository(opened) {
    this.repositories.set(opened.repositoryId, { ...opened, open: true });
    this.preferences.saveRepositories();
  }

  confirmWorkspaceReplacement() {
    const state = this.host.getState();
    if ((state.dirtyFiles.size || state.membershipDirty) &&
      !globalThis.confirm('Load the selected Git worktree into Studio? Export the current workspace first if you need to keep its changes.')) {
      throw new Error('Repository switch cancelled.');
    }
  }

  async applyIdentity(options) {
    const { userName, userEmail, defaultBranch } = this.preferences.model.values;
    const changes = { 'init.defaultBranch': defaultBranch };
    if (userName) changes['user.name'] = userName;
    if (userEmail) changes['user.email'] = userEmail;
    await this.request('configuration', { changes }, options);
  }

  async selectRepository(repositoryId) {
    if (repositoryId === this.repositoryId) return;
    this.assertWorktreeChange();
    this.confirmWorkspaceReplacement();
    await this.run(async options => {
      await this.synchronize(options);
      const saved = this.repositories.get(repositoryId);
      if (!saved) throw new Error('Unknown repository.');
      if (!saved.open) this.rememberRepository(await this.request('open', saved, options));
      checkGitWorkspaceLoad(options);
      await this.adoptRepository(options, { openWorkspace: true, repositoryId });
    }, { workspace: true });
  }

  branchDialog() { return this.safe(() => showGitBranchPicker(this)); }
  createBranchDialog() { return showCreateGitBranch(this); }
  mergeDialog() { return this.safe(() => showMergeGitBranch(this)); }

  remoteAction(action) {
    return this.run(async options => {
      await this.synchronize(options);
      const remotes = await this.request('remotes', {}, options);
      const remote = remotes.find(item => item.name === 'origin') ?? remotes[0];
      if (!remote) throw new Error('Add a remote in Git Settings before fetching or pushing.');
      const parameters = await this.preferences.networkParameters(remote, { write: action === 'push', signal: options.signal });
      if (action === 'pull') {
        checkGitWorkspaceLoad(options);
        await this.request('fetch', parameters, options);
        await this.request('merge', { revision: '@{upstream}' }, options);
        await this.adoptRepository(options);
      } else await this.request(action, parameters, options);
    }, { workspace: action === 'pull' });
  }

  remoteDialog() {
    return gitDialog(document, {
      title: 'Add Git Remote', submitLabel: 'Add Remote', fields: [
        { name: 'name', label: 'Remote name', value: 'origin', required: true },
        { name: 'url', label: 'Repository HTTPS URL', type: 'url', required: true }
      ], onSubmit: values => this.run(options => this.request('changeRemote', { ...values, action: 'add' }, options))
    });
  }

  openDiff(path, staged = false) {
    this.selection = { path, staged };
    this.host.showPanel('git-diff');
  }

  openMerge(path) {
    this.selection = { path };
    this.host.showPanel('git-merge');
  }

  async toggleBlameMargin() {
    const editor = this.host.getEditors().get(this.host.getState().active);
    if (this.blameMargin) { this.blameMargin.dispose(); this.blameMargin = null; return; }
    if (!this.repositoryId || !this.workspaceBound) throw new Error('Open the matching Git repository before showing blame.');
    this.blameMargin = await createGitBlameMargin(this, editor);
  }

  decorateExplorer() {
    decorateGitExplorer(document, this.workspaceBound ? this.allChanges : []);
  }

  async dispose() {
    if (this.closed) return;
    this.closed = true;
    this.controller?.abort();
    this.refreshController?.abort();
    this.explorerObserver.disconnect();
    const cleanups = [() => cancelGitWorkspaceLoad(this.host), () => this.blameMargin?.dispose(),
      () => this.reviewAnnotations?.dispose(), () => this.collaboration.dispose()];
    for (const { state } of this.mounts.values()) {
      state.gitGeneration++;
      state.renderController?.abort();
      cleanups.push(() => state.dispose?.());
    }
    this.mounts.clear();
    const results = await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)));
    try { await this.client.dispose(); }
    finally { this.worker.terminate(); }
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Git panel disposal failed');
  }
}
