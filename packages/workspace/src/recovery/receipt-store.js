import {hashWorkspaceBytes, throwIfWorkspaceAborted} from '../content-hash.js';
import {encodeRecoveryRecord, decodeRecoveryRecord} from './integrity.js';
import {sanitizeRecoveryValue} from './schema.js';
import {readRecoveryText, writeRecoveryText} from './io.js';

const unloaded = record => record.lazy && typeof record.text !== 'string' && !record.bytes;
const operationFields = operation => ({kind: operation.kind, path: operation.path, destination: operation.destination,
  beforeHash: operation.beforeHash, afterHash: operation.afterHash});

/** Durable write-ahead receipts. Large before/after snapshots are written once; only the bounded progress manifest changes per effect. */
export class WorkspaceReceiptStore {
  constructor({directory, maxEntries = 32, maxSnapshotBytes = 256 * 1024 * 1024}) {
    Object.assign(this, {directory, maxEntries, maxSnapshotBytes});
    this.prepared = new WeakMap();
    this.disposed = false;
  }

  async save(receipt, {signal} = {}) {
    if (this.disposed) throw new Error('SFW1130: Transaction receipt store is disposed');
    throwIfWorkspaceAborted(signal);
    if (!Number.isSafeInteger(receipt.id) || receipt.id < 1) throw new Error('SFW1130: Invalid transaction identity');
    let entry = this.prepared.get(receipt);
    if (!entry) {
      const before = await encodeRecoveryRecord({...receipt.before, records: receipt.before.records.filter(record => !unloaded(record))});
      const after = await encodeRecoveryRecord({...receipt.after, records: receipt.after.records.filter(record => !unloaded(record))});
      if ((before.length + after.length) * 2 > this.maxSnapshotBytes) throw new Error('SFW1131: Transaction snapshot byte budget exceeded');
      const name = 'transaction-' + receipt.id;
      const directory = await this.directory.getDirectoryHandle(name, {create: true});
      await writeRecoveryText(directory, 'before.json', before, signal);
      await writeRecoveryText(directory, 'after.json', after, signal);
      entry = {name, directory};
      this.prepared.set(receipt, entry);
    }
    const payload = sanitizeRecoveryValue({version: 1, id: receipt.id, label: receipt.label, status: receipt.status,
      operations: receipt.operations.map(operationFields), completedMutations: receipt.completedMutations.map(operationFields),
      beforeUnloaded: receipt.before.records.filter(unloaded), afterUnloaded: receipt.after.records.filter(unloaded),
      error: receipt.error, storageError: receipt.storageError});
    const text = JSON.stringify(payload);
    const checksum = await hashWorkspaceBytes(new TextEncoder().encode(text), {signal});
    await writeRecoveryText(entry.directory, 'receipt.json', JSON.stringify({checksum, payload}), signal);
    await writeRecoveryText(this.directory, 'current.json', JSON.stringify({version: 1, name: entry.name}), signal);
    if (receipt.status.startsWith('committed')) await this.trim(entry.name);
  }

  async trim(current) {
    const entries = [];
    for await (const [name] of this.directory.entries()) if (/^transaction-\d+$/.test(name)) entries.push(name);
    entries.sort((left, right) => Number(right.slice(12)) - Number(left.slice(12)));
    for (const name of entries.slice(this.maxEntries)) if (name !== current) await this.directory.removeEntry(name, {recursive: true});
  }

  async load({signal} = {}) {
    if (this.disposed) throw new Error('SFW1130: Transaction receipt store is disposed');
    const pointer = await readRecoveryText(this.directory, 'current.json');
    if (pointer === null) return null;
    const current = JSON.parse(pointer);
    if (current.version !== 1 || !/^transaction-[1-9]\d{0,15}$/.test(current.name)) throw new Error('SFW1132: Invalid receipt pointer');
    const directory = await this.directory.getDirectoryHandle(current.name);
    const envelope = JSON.parse(await readRecoveryText(directory, 'receipt.json'));
    const text = JSON.stringify(envelope.payload);
    if (await hashWorkspaceBytes(new TextEncoder().encode(text), {signal}) !== envelope.checksum) {
      throw new Error('SFW1132: Transaction receipt checksum mismatch');
    }
    const before = await decodeRecoveryRecord(await readRecoveryText(directory, 'before.json'), {signal});
    const after = await decodeRecoveryRecord(await readRecoveryText(directory, 'after.json'), {signal});
    return {...envelope.payload, before: {...before, records: [...before.records, ...envelope.payload.beforeUnloaded]},
      after: {...after, records: [...after.records, ...envelope.payload.afterUnloaded]}};
  }

  dispose() { this.disposed = true; this.prepared = new WeakMap(); }
}
