import {OpfsRecoveryStore, WorkspaceReceiptStore, RecentWorkspaceHandles, WorkspaceRevisionChannel, WorkspaceConflictCoordinator, WorkspaceSaveLocks,
  hashWorkspaceBytes, hashWorkspaceRecord, workspaceRecordSource, workspaceRecordBytes, migrateWorkspaceRecovery} from '@sharpforge/workspace';
import {studioDiskLimits} from '../workbench/workspace-limits.js';
import {sameRevisionContents as sameContents, captureRevisionRecord, readRevisionContent} from './revision-records.js';

const recoveryLimits = {maxFiles: studioDiskLimits.maxFiles, maxBytes: studioDiskLimits.maxTotalBytes * 4,
  maxEncodedBytes: studioDiskLimits.maxTotalBytes * 8};
const unloaded = record => record?.lazy && !workspaceRecordSource(record) && typeof record.text !== 'string' && !record.bytes;

/** Explorer recovery and revision lifecycle. Directory identity is bound to isSameEntry, independent of names and session epochs. */
export class ExplorerPersistence {
  constructor({getData, onCommand, onWarning, onChange, environment = globalThis, handles = null}) {
    Object.assign(this, {getData, onCommand, onWarning, onChange, environment});
    this.handles = handles ?? (environment.indexedDB ? new RecentWorkspaceHandles({indexedDB: environment.indexedDB}) : null);
    this.identity = null;
    this.sessionKey = null;
    this.generation = 0;
    this.documents = new Map();
    this.liveFiles = new Map();
    this.baselines = new Map();
    this.windowId = environment.crypto?.randomUUID?.() ?? null;
    this.revisionQueue = Promise.resolve();
    this.disposed = false;
  }

  async folderIdentity(data) {
    const handle = data.disk?.rootHandle;
    if (handle) {
      if (!this.handles) throw new Error('SFW1321: IndexedDB is required to remember this folder identity');
      return this.handles.identify(handle, {locks: this.environment.navigator?.locks});
    }
    return data.coordinationIdentity ?? null;
  }

  async directoryFor(identity, create = false) {
    const storage = this.environment.navigator?.storage;
    if (!storage?.getDirectory) throw new Error('SFW1311: OPFS recovery is unavailable');
    const hash = await hashWorkspaceBytes(new TextEncoder().encode(identity));
    const root = await storage.getDirectory();
    return root.getDirectoryHandle('sharpforge-workspace-' + hash, {create});
  }

  async open(data) {
    const generation = ++this.generation;
    this.sessionKey = data.identity ?? data.name;
    this.channel?.dispose();
    this.store?.dispose();
    this.receiptStore?.dispose();
    this.saveLocks?.dispose();
    this.channel = null;
    this.conflicts = null;
    this.store = null;
    this.receiptStore = null;
    this.workspaceDirectory = null;
    this.documents.clear();
    this.baselines.clear();
    this.savedSignature = null;
    this.contentRevision = 0;
    let sharedIdentity = null;
    try { sharedIdentity = await this.folderIdentity(data); }
    catch (error) { this.warning({code: 'SFW1325', message: error.message}); }
    if (generation !== this.generation || this.disposed) return;
    this.sharedIdentity = sharedIdentity;
    // Unbound buffers have recovery only. Display names must never connect unrelated folders for editing or saving.
    this.identity = sharedIdentity ?? 'preview-recovery:' + (data.entry ?? data.name ?? 'Workspace');
    if (sharedIdentity && this.environment.navigator?.locks) {
      this.saveLocks = new WorkspaceSaveLocks({identity: sharedIdentity, locks: this.environment.navigator.locks});
      if (data.disk) data.disk.saveLocks = this.saveLocks;
    }
    if (this.environment.navigator?.storage?.getDirectory && this.windowId) {
      try {
        const workspace = await this.directoryFor(this.identity, true);
        const directory = await workspace.getDirectoryHandle('window-' + this.windowId, {create: true});
        if (generation !== this.generation || this.disposed) return;
        this.workspaceDirectory = workspace;
        this.store = new OpfsRecoveryStore({directory, storage: this.environment.navigator.storage,
          onWarning: value => this.warning(value), limits: recoveryLimits});
        this.receiptStore = new WorkspaceReceiptStore({directory: await directory.getDirectoryHandle('transactions', {create: true}),
          maxSnapshotBytes: recoveryLimits.maxBytes});
        this.lastReceipt = await this.receiptStore.load();
        if (this.lastReceipt && !this.lastReceipt.status.startsWith('committed')) this.warning({code: 'SFW1133',
          message: 'An interrupted file operation has a recovery receipt with ' + this.lastReceipt.completedMutations.length + ' completed disk changes.'});
      } catch (error) { this.warning({code: 'SFW1311', message: error.message}); }
    }
    if (generation !== this.generation || this.disposed) return;
    if (sharedIdentity && this.environment.BroadcastChannel && this.windowId) {
      this.channel = new WorkspaceRevisionChannel({identity: sharedIdentity, windowId: this.windowId,
        channelFactory: name => new this.environment.BroadcastChannel(name), onError: error => this.warning({message: error.message}),
        onRevision: remote => { this.conflicts.observe(remote); this.onChange?.(); }});
      this.conflicts = new WorkspaceConflictCoordinator({channel: this.channel,
        getDocument: path => this.documentFor(path), readLocal: (document, options) => this.readLocal(document, options),
        applyResolution: async resolution => {
          const response = await this.onCommand('apply-conflict-resolution', {path: resolution.path}, [], {resolution});
          if (response?.error) throw new Error(response.error);
          this.baselines.set(resolution.path, resolution.content);
          const current = this.documents.get(resolution.path);
          if (current) current.revision = Math.max(current.revision, resolution.revision);
        }});
    }
  }

  /** Await before a directory save so its physical identity and exclusive lock have been installed. */
  ready() { return this.opening ?? Promise.resolve(); }

  async saveReceipt(receipt) {
    await this.ready();
    if (!this.receiptStore) {
      if (this.getData().disk?.rootHandle) throw new Error('SFW1131: Persistent directory operations require OPFS transaction receipts');
      return;
    }
    await this.receiptStore.save(receipt);
    this.lastReceipt = receipt;
  }

  warning(value) {
    this.lastWarning = value;
    this.onWarning?.(value);
    this.onChange?.();
  }

  documentFor(path) {
    const document = this.documents.get(path);
    const file = this.liveFiles.get(path);
    if (!file || !document || unloaded(file)) return null;
    const metadata = {path, revision: document.revision, hash: document.hash, encoding: document.encoding, bom: document.bom};
    if (sameContents(document, file)) return metadata;
    // Visible edits invalidate a conflict dialog even while their asynchronous digest is pending.
    return {...metadata, revision: document.revision + 1, hash: null};
  }

  async readLocal(observed, options = {}) {
    const current = this.documentFor(observed.path);
    if (!current || current.hash !== observed.hash || current.revision !== observed.revision) {
      throw new Error('SFW1422: Local document changed while preparing conflict contents');
    }
    const record = this.documents.get(observed.path);
    return {...observed, content: readRevisionContent(record, options),
      baseContent: readRevisionContent(this.baselines.get(observed.path), options), bytes: record.bytes,
      originalText: record.originalText, lineEndings: record.lineEndings, preferredLineEnding: record.preferredLineEnding,
      preserveLineEndings: record.preserveLineEndings};
  }

  canReleaseDocument(path) {
    return !this.conflicts?.conflicts.has(path) && !this.conflicts?.pending.has(path);
  }

  /** Discard closed source bodies while retaining only their revision/hash watermark for a later reopen. */
  releaseDocument(path) {
    const data = this.getData();
    const file = (data.records ?? data.files ?? []).find(record => (record.path ?? record.uri) === path);
    if (!unloaded(file) || data.tabs?.includes(path) || data.dirty?.includes(path) ||
        !this.canReleaseDocument(path)) return false;
    this.liveFiles.set(path, file);
    const document = this.documents.get(path);
    if (document) this.documents.set(path, {path, revision: document.revision, hash: document.hash, unloaded: true});
    this.baselines.delete(path);
    if (document && !document.unloaded) this.contentRevision++;
    if (this.nextCheckpoint) this.nextCheckpoint = {data, generation: this.generation};
    return true;
  }

  observe(data) {
    if (this.disposed || data.native) return;
    this.liveFiles = new Map((data.records ?? data.files ?? []).map(file => [file.path ?? file.uri, file]));
    for (const path of this.documents.keys()) if (!this.liveFiles.has(path)) {
      this.documents.delete(path);
      this.baselines.delete(path);
    }
    if ((data.identity ?? data.name) !== this.sessionKey) {
      this.opening = this.open(data).catch(error => this.warning({code: 'SFW1311', message: error.message}));
    }
    const generation = this.generation;
    // Revision notifications are independent of recovery debounce and disk I/O.
    this.revisionQueue = this.revisionQueue.then(() => this.updateRevisions(data, generation))
      .catch(error => this.warning({message: error.message}));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.checkpoint(this.getData()).catch(error => this.warning({message: error.message})), 200);
  }

  async updateRevisions(data, generation) {
    await this.ready();
    if (this.disposed || generation !== this.generation) return;
    for (const source of data.records ?? data.files ?? []) {
      const path = source.path ?? source.uri;
      if (unloaded(source)) { this.releaseDocument(path); continue; }
      const file = captureRevisionRecord(source);
      if (!sameContents(file, this.liveFiles.get(path))) continue;
      const previous = this.documents.get(path);
      if (sameContents(previous, file)) continue;
      const hash = await hashWorkspaceRecord(file);
      if (this.disposed || generation !== this.generation) return;
      if (!sameContents(file, this.liveFiles.get(path))) continue;
      if (!this.baselines.has(path)) this.baselines.set(path, file);
      const revision = Math.max(file.version ?? data.revision ?? 0, (this.documents.get(path)?.revision ?? -1) + 1);
      const document = Object.defineProperties({}, {...Object.getOwnPropertyDescriptors(file),
        revision: {value: revision, writable: true}, hash: {value: hash, configurable: true, writable: true},
        baseHash: {value: previous?.hash ?? hash, configurable: true}
      });
      this.documents.set(path, document);
      this.contentRevision++;
      this.channel?.publishRevision(document);
    }
  }

  async checkpoint(data) {
    await this.ready();
    await this.revisionQueue;
    if (this.disposed || data.native || (data.identity ?? data.name) !== this.sessionKey) return;
    this.nextCheckpoint = {data, generation: this.generation};
    if (this.saving) return this.saving;
    this.saving = this.savePending().finally(() => { this.saving = null; });
    return this.saving;
  }

  async savePending() {
    while (this.nextCheckpoint && !this.disposed) {
      const {data, generation} = this.nextCheckpoint;
      this.nextCheckpoint = null;
      if (generation !== this.generation) continue;
      const signature = JSON.stringify([this.contentRevision, data.revision, data.active, data.tabs, data.folders,
        data.entry, data.startup, data.settings, data.dirty]);
      if (signature === this.savedSignature) continue;
      const records = data.records ?? data.files ?? [];
      const record = migrateWorkspaceRecovery({records, identity: this.identity, name: data.name, folders: data.folders,
        active: data.active, entry: data.entry, startup: data.startup, breakpoints: data.breakpoints, revision: data.revision,
        settings: data.settings, appDescriptors: data.appDescriptors, explorer: data.explorer, recentTemplates: data.recentTemplates,
        dirty: data.dirty, documentStates: data.documentStates, savedAt: Date.now(), openDocuments: data.tabs ?? []}, recoveryLimits);
      const store = this.store;
      if (store) await store.save(record);
      if (generation !== this.generation || this.disposed) continue;
      if (data.disk?.rootHandle && this.handles && this.sharedIdentity) {
        await this.handles.remember({identity: this.identity, handle: data.disk.rootHandle,
          name: data.name, openDocuments: record.openDocuments});
      }
      this.savedSignature = signature;
    }
  }

  async readRemote(remote) {
    if (!this.workspaceDirectory || !/^[A-Za-z0-9-]{1,128}$/.test(remote.sender)) {
      throw new Error('SFW1423: Cross-window contents require an OPFS checkpoint; import the other window snapshot');
    }
    const directory = await this.workspaceDirectory.getDirectoryHandle('window-' + remote.sender);
    const result = await new OpfsRecoveryStore({directory, limits: recoveryLimits}).load();
    const record = result.record?.records.find(file => file.path === remote.path);
    if (!record) throw new Error('SFW1423: Other window recovery is not ready; retry after its checkpoint completes');
    return {content: readRevisionContent(record), bytes: workspaceRecordBytes(record, {maxBytes: 16 * 1024 * 1024})};
  }

  async prepareConflict(path) {
    await this.revisionQueue;
    const conflict = this.conflicts?.conflicts.get(path);
    if (conflict) this.conflicts.observe(conflict.remote);
  }

  async resolve(path, choice) {
    if (!this.conflicts) throw new Error('Cross-window revision coordination is unavailable');
    const result = await this.conflicts.resolve(path, choice, {readRemote: remote => this.readRemote(remote)});
    if (result.status === 'conflict') this.warning({message: 'Edits overlap. Both buffers are preserved; choose a version or merge manually.'});
    if (result.pendingConflict) this.warning({message: 'The selected version was applied, but a newer peer revision arrived. Review the remaining conflict.'});
    this.onChange?.();
    return result;
  }

  async recent(identity = this.identity) {
    await this.ready();
    const directory = identity === this.identity ? this.workspaceDirectory : await this.directoryFor(identity);
    if (!directory) throw new Error('OPFS recovery is unavailable in this browser');
    const results = [];
    let count = 0;
    for await (const [name, child] of directory.entries()) {
      if (!name.startsWith('window-') || child.kind !== 'directory') continue;
      if (++count > 64) { this.warning({message: 'Recovery window limit reached; showing first 64 snapshots'}); break; }
      const result = await new OpfsRecoveryStore({directory: child, limits: recoveryLimits}).load();
      if (result.record) results.push(result.record);
      for (const diagnostic of result.diagnostics) this.warning(diagnostic);
    }
    return results.sort((left, right) => right.savedAt - left.savedAt);
  }

  async recentFolders() {
    if (!this.handles) throw new Error('Recent folder handles require IndexedDB');
    return this.handles.list();
  }

  async reopenRecent(identity) {
    if (!this.handles) throw new Error('Recent folder handles require IndexedDB');
    const result = await this.handles.reopen(identity, {recovery: async () => (await this.recent(identity))[0] ?? null});
    if (result.permission === 'granted') result.record = (await this.recent(identity))[0] ?? null;
    return result;
  }

  async requestPersistence() {
    await this.ready();
    if (!this.store) throw new Error('OPFS recovery is unavailable in this browser');
    return this.store.requestPersistence();
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    clearTimeout(this.timer);
    this.channel?.dispose();
    this.store?.dispose();
    this.receiptStore?.dispose();
    this.saveLocks?.dispose();
    this.handles?.dispose();
    this.documents.clear();
    this.liveFiles.clear();
    this.baselines.clear();
    this.nextCheckpoint = null;
  }
}
