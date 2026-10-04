/** Saves capture versions before awaiting disk I/O so late completion cannot clear newer edits. */
export class StudioSave {
  constructor({ documents, state, nativeBuild, saveRecovery, notify, refresh }) {
    Object.assign(this, { documents, state, nativeBuild, saveRecovery, notify, refresh });
  }

  async source(snapshot) {
    const state = this.state();
    if (state.nativeMode) {
      const native = this.nativeBuild();
      if (!native.client) throw new Error('No local host is connected');
      if (native.job && !['succeeded', 'failed', 'cancelled'].includes(native.job.status)) {
        throw new Error('Stop the native operation before saving inputs');
      }
      const change = { path: snapshot.uri, text: snapshot.text, expectedHash: snapshot.nativeHash };
      const reconcile = written => {
        for (const saved of written ?? []) if (saved.path === change.path) native.onSaved?.(saved, change);
      };
      let report;
      try { report = await native.client.save([change]); }
      catch (error) { reconcile(error.written); throw error; }
      reconcile(report.written);
      return report.written?.some(file => file.path === snapshot.uri) ?? false;
    }
    if (state.disk?.handles.has(snapshot.uri)) {
      const report = await state.disk.save([{ uri: snapshot.uri, text: snapshot.text }]);
      this.saveRecovery();
      return report.written.includes(snapshot.uri);
    }
    if (!this.saveRecovery()) throw new Error('Local recovery could not save this document; export the workspace to keep it.');
    return true;
  }

  async all() {
    const uris = this.documents.list().filter(record => record.dirty).map(record => record.uri);
    for (const uri of uris) if (!await this.documents.save(uri)) return false;
    this.refresh();
    return true;
  }

  async disk() {
    const state = this.state();
    if (state.nativeMode) return this.nativeBuild().save();
    if (state.membershipDirty) throw new Error('Export the full workspace to preserve structural file changes before saving source only.');
    if (!state.disk?.handles.size) throw new Error('No writable folder is attached. Open a folder or export the workspace.');
    for (const [uri, editor] of this.documents.editors) {
      if (state.disk.handles.has(uri) && this.documents.get(uri)?.dirty) await editor.prepareSave?.();
    }
    const changes = this.documents.list().filter(record => state.disk.handles.has(record.uri) && record.dirty)
      .map(record => ({ uri: record.uri, text: record.text, version: record.version }));
    if (!changes.length) return { written: [] };
    const report = await state.disk.save(changes.map(({ uri, text }) => ({ uri, text })));
    const snapshots = new Map(changes.map(record => [record.uri, record]));
    for (const uri of report.written) {
      const snapshot = snapshots.get(uri);
      if (snapshot && this.documents.get(uri)) this.documents.markSaved(uri, snapshot);
    }
    this.saveRecovery();
    this.notify(`Saved ${report.written.length} source file(s) to disk.`);
    this.refresh();
    return report;
  }
}
