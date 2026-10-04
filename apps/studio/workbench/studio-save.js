import { DiskWorkspace } from '@sharpforge/project-system';
import { readStudioSource } from './studio-source-reader.js';
import { studioDiskLimits } from './workspace-limits.js';
import { StudioSaveOperation } from './studio-save-operation.js';

const sourceChange = snapshot => snapshot.source
  ? { uri: snapshot.uri, source: snapshot.source } : { uri: snapshot.uri, text: snapshot.text };

/** File targets and late completion belong to exact document instances and captured immutable source roots. */
export class StudioSave {
  constructor({ documents, state, nativeBuild, saveRecovery, canRecover, saveAs, notify, refresh }) {
    Object.assign(this, { documents, state, nativeBuild, saveRecovery, canRecover, saveAs, notify, refresh });
    this.sourceTargets = new Map();
    this.operations = new Set();
    this.disposed = false;
    this.unsubscribe = documents.subscribe(event => {
      if (event.type !== 'reset' && event.type !== 'removed') return;
      for (const [uri, target] of this.sourceTargets) if (documents.get(uri) !== target.record) {
        if (target.model && documents.models.get(uri) === target.model) target.record = documents.get(uri);
        else this.sourceTargets.delete(uri);
      }
      for (const operation of this.operations) {
        if (![...operation.records.keys()].every(uri => operation.current(uri))) operation.abort();
      }
    });
  }

  target(uri) {
    const target = this.sourceTargets.get(uri);
    return target?.record === this.documents.get(uri) ? target.disk : this.state().disk;
  }

  begin(uris) { return new StudioSaveOperation(this, uris.map(uri => this.documents.require(uri))); }

  /** Called before editor preparation, so a required picker retains the user's original activation. */
  async coordinate({ snapshot, prepare, isCurrent }) {
    const operation = this.begin([snapshot.uri]);
    try {
      if (!this.state().nativeMode && !this.target(snapshot.uri)?.handles.has(snapshot.uri) && this.canRecover?.() === false) {
        const result = await this.saveSnapshotAs(snapshot, { operation, prepare });
        return { ...result, snapshot: result?.source ? result : snapshot };
      }
      snapshot = await prepare({ signal: operation.signal });
      operation.check();
      if (!isCurrent()) return { ok: false };
      const result = await this.write(snapshot, operation);
      return { ok: result !== false && result?.ok !== false, snapshot, result };
    } finally { operation.finish(); }
  }

  async source(snapshot) {
    const operation = this.begin([snapshot.uri]);
    try { return await this.write(snapshot, operation); }
    finally { operation.finish(); }
  }

  async write(snapshot, operation) {
    operation.check();
    if (this.state().nativeMode) return this.native(snapshot, operation);
    const disk = this.target(snapshot.uri);
    if (disk?.handles.has(snapshot.uri)) {
      if (this.state().membershipDirty && disk === this.state().disk) {
        throw new Error('Export the full workspace to preserve structural file changes before saving source only.');
      }
      const report = await disk.save([sourceChange(snapshot)], { signal: operation.signal });
      if (!operation.current(snapshot.uri)) return false;
      this.saveRecovery();
      return report.written.includes(snapshot.uri);
    }
    if (!this.saveRecovery()) return this.saveSnapshotAs(snapshot, { operation });
    return true;
  }

  async native(snapshot, operation) {
    const native = this.nativeBuild();
    if (!native.client) throw new Error('No local host is connected');
    if (native.job && !['succeeded', 'failed', 'cancelled'].includes(native.job.status)) {
      throw new Error('Stop the native operation before saving inputs');
    }
    const client = native.client;
    const change = { path: snapshot.uri, text: snapshot.text, expectedHash: snapshot.nativeHash };
    const reconcile = written => {
      if (!operation.current(snapshot.uri) || native.client !== client) return;
      for (const saved of written ?? []) if (saved.path === change.path) native.onSaved?.(saved, change);
    };
    let report;
    try { report = await client.save([change]); }
    catch (error) { reconcile(error.written); throw error; }
    reconcile(report.written);
    return operation.current(snapshot.uri) && this.state().nativeMode && native.client === client
      && (report.written?.some(file => file.path === snapshot.uri) ?? false);
  }

  async saveSnapshotAs(snapshot, { operation, prepare } = {}) {
    if (this.state().nativeMode) throw new Error('Use the connected local host to choose a native workspace save destination.');
    if (!this.saveAs) throw new Error('Local recovery could not save this document; choose an explicit file save provider.');
    const ownsOperation = !operation;
    operation ??= this.begin([snapshot.uri]);
    try {
      operation.check();
      const result = await this.saveAs(snapshot, { signal: operation.signal, prepare });
      if (!operation.current(snapshot.uri)) return { ...result, ok: false, cancelled: true };
      if (result?.ok && result.handle) this.rememberTarget(result.source ? result : snapshot, result, operation);
      return result;
    } finally { if (ownsOperation) operation.finish(); }
  }

  rememberTarget(snapshot, result, operation) {
    const saved = { path: snapshot.uri, source: snapshot.source, version: snapshot.version,
      encoding: snapshot.encoding, bom: snapshot.bom, byteLength: result.byteLength };
    if (!saved.source) saved.text = snapshot.text;
    const disk = new DiskWorkspace([saved], new Map([[snapshot.uri, result.handle]]), result.name, [], [], {
      ...studioDiskLimits, readSource: readStudioSource
    });
    this.sourceTargets.set(snapshot.uri, { record: operation.records.get(snapshot.uri), model: this.documents.models.get(snapshot.uri), disk });
  }

  async as(uri = this.documents.active) {
    const operation = this.begin([uri]);
    const initial = this.documents.captureSave(uri);
    const editor = this.documents.views.get(uri)?.get(this.documents.activeViews.get(uri))?.editor ?? this.documents.editors.get(uri);
    const prepare = async options => {
      operation.check();
      await editor?.prepareSave?.(options);
      operation.check();
      return this.documents.captureSave(uri);
    };
    try {
      const result = await this.saveSnapshotAs(initial, { operation, prepare });
      if (result?.ok !== true || !operation.current(uri)) return result;
      this.documents.markSaved(uri, result.source ? result : initial);
      this.refresh();
      return result;
    } finally { operation.finish(); }
  }

  async all() {
    const records = this.documents.list().filter(record => record.dirty);
    for (const record of records) {
      if (this.disposed || this.documents.get(record.uri) !== record || !await this.documents.save(record.uri)) return false;
    }
    if (this.disposed) return false;
    this.refresh();
    return true;
  }

  async disk() {
    const state = this.state();
    if (state.nativeMode) return this.nativeBuild().save();
    if (state.membershipDirty) throw new Error('Export the full workspace to preserve structural file changes before saving source only.');
    const records = this.documents.list().filter(record => record.dirty && this.target(record.uri)?.handles.has(record.uri));
    if (!state.disk?.handles.size && !this.sourceTargets.size) throw new Error('No writable folder is attached. Open a folder or export the workspace.');
    if (!records.length) return { written: [] };
    const operation = this.begin(records.map(record => record.uri));
    try {
      const groups = await this.prepareDiskGroups(records, operation);
      const written = [];
      for (const [disk, captures] of groups) {
        operation.check();
        try {
          const report = await disk.save(captures.map(sourceChange), { signal: operation.signal });
          written.push(...report.written);
          this.reconcile(report.written, captures, operation);
        } catch (error) {
          this.reconcile(error.written, captures, operation);
          error.written = [...written, ...(error.written ?? [])];
          throw error;
        }
      }
      if (!this.disposed) this.notify('Saved ' + written.length + ' source file(s) to disk.');
      return { written, atomic: false };
    } finally { operation.finish(); }
  }

  async prepareDiskGroups(records, operation) {
    const groups = new Map();
    for (const record of records) {
      operation.check();
      const editor = this.documents.views.get(record.uri)?.get(this.documents.activeViews.get(record.uri))?.editor
        ?? this.documents.editors.get(record.uri);
      const prepared = editor?.prepareSave?.({ signal: operation.signal });
      if (prepared && typeof prepared.then === 'function') await prepared;
      operation.check();
      const disk = this.target(record.uri);
      if (!groups.has(disk)) groups.set(disk, []);
      groups.get(disk).push(this.documents.captureSave(record.uri));
    }
    return groups;
  }

  reconcile(written, captures, operation) {
    const snapshots = new Map(captures.map(snapshot => [snapshot.uri, snapshot]));
    for (const uri of written ?? []) {
      if (operation.current(uri) && snapshots.has(uri)) this.documents.markSaved(uri, snapshots.get(uri));
    }
    if (!this.disposed && [...operation.records.keys()].some(uri => operation.current(uri))) {
      this.saveRecovery();
      this.refresh();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const operation of this.operations) operation.abort();
    this.operations.clear();
    this.sourceTargets.clear();
  }
}
