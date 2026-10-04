/** Read-only compatibility view: the independent save baselines are SHA-256 hashes, never retained source strings. */
export class DiskTextBaselines {
  constructor(workspace) { this.workspace = workspace; }
  has(path) { return isTextRecord(this.workspace.record(path)); }
  get(path) { return recordText(this.workspace.record(path)); }
  *entries() {
    for (const record of this.workspace.records) if (isTextRecord(record)) yield [record.path, recordText(record)];
  }
  *keys() { for (const [path] of this.entries()) yield path; }
  *values() { for (const [, text] of this.entries()) yield text; }
  get size() { let count = 0; for (const _ of this.entries()) count++; return count; }
  [Symbol.iterator]() { return this.entries(); }
}

export function diskRecordBytes(record) {
  if (!record || record.lazy) return 0;
  return workspaceRecordBytes(record).length;
}
import {workspaceRecordBytes} from '@sharpforge/workspace';
import {isTextRecord, recordText} from './workspace-records.js';
