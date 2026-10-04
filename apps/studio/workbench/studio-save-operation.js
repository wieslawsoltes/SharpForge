/** A save belongs to captured document identities, even when a replacement reuses their URIs and versions. */
export class StudioSaveOperation {
  constructor(owner, records) {
    this.owner = owner;
    this.records = new Map(records.map(record => [record.uri, record]));
    this.models = new Map(records.map(record => [record.uri, owner.documents.models.get(record.uri)]));
    this.targets = new Map(records.map(record => [record.uri, owner.target(record.uri)]));
    const state = owner.state();
    this.workspace = {disk: state.disk, epoch: state.workspaceEpoch, nativeMode: state.nativeMode};
    this.controller = new AbortController();
    this.check();
    owner.operations.add(this);
  }

  get signal() { return this.controller.signal; }

  current(uri) {
    return this.ownsWorkspace() && this.owner.documents.get(uri) === this.records.get(uri)
      && this.owner.documents.models.get(uri) === this.models.get(uri) && this.owner.target(uri) === this.targets.get(uri);
  }

  ownsWorkspace() {
    const state = this.owner.state();
    return !this.owner.disposed && !this.signal.aborted && !this.owner.documents.disposed
      && state.disk === this.workspace.disk && state.workspaceEpoch === this.workspace.epoch && state.nativeMode === this.workspace.nativeMode;
  }

  check() {
    if (!this.ownsWorkspace() || ![...this.records.keys()].every(uri => this.current(uri))) {
      this.abort();
      throw new DOMException('The save operation no longer owns these documents', 'AbortError');
    }
  }

  abort() { this.controller.abort(); }
  adoptTarget(uri, disk) { this.targets.set(uri, disk); }
  finish() { this.owner.operations.delete(this); }
}
