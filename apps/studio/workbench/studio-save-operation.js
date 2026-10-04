/** A save belongs to captured document identities, even when a replacement reuses their URIs and versions. */
export class StudioSaveOperation {
  constructor(owner, records) {
    this.owner = owner;
    this.records = new Map(records.map(record => [record.uri, record]));
    this.controller = new AbortController();
    this.check();
    owner.operations.add(this);
  }

  get signal() { return this.controller.signal; }

  current(uri) {
    return !this.owner.disposed && !this.signal.aborted && !this.owner.documents.disposed
      && this.owner.documents.get(uri) === this.records.get(uri);
  }

  check() {
    if (![...this.records.keys()].every(uri => this.current(uri))) {
      this.abort();
      throw new DOMException('The save operation no longer owns these documents', 'AbortError');
    }
  }

  abort() { this.controller.abort(); }
  finish() { this.owner.operations.delete(this); }
}
