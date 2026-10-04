/** Read-only compatibility view: the independent save baselines are SHA-256 hashes, never retained source strings. */
export class DiskTextBaselines {
  constructor(workspace) { this.workspace = workspace; }
  has(path) { return typeof this.workspace.record(path)?.text === 'string'; }
  get(path) { return this.workspace.record(path)?.text; }
  *entries() {
    for (const record of this.workspace.records) if (typeof record.text === 'string') yield [record.path, record.text];
  }
  *keys() { for (const [path] of this.entries()) yield path; }
  *values() { for (const [, text] of this.entries()) yield text; }
  get size() { let count = 0; for (const _ of this.entries()) count++; return count; }
  [Symbol.iterator]() { return this.entries(); }
}

export function diskRecordBytes(record) {
  if (!record || record.lazy) return 0;
  return record.bytes?.length ?? (typeof record.text === 'string' ? new TextEncoder().encode(record.text).length : 0);
}
