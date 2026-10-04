import {hashWorkspaceBytes, throwIfWorkspaceAborted} from '../content-hash.js';
import {encodeRecoveryRecord, decodeRecoveryRecord} from './integrity.js';
import {sanitizeRecoveryValue} from './schema.js';
import {readRecoveryText, writeRecoveryText} from './io.js';
import {workspaceRecordSource} from '../transaction-records.js';

const unloaded = record => record.lazy && !workspaceRecordSource(record) && typeof record.text !== 'string' && !record.bytes;
const operationFields = operation => ({kind: operation.kind, path: operation.path, destination: operation.destination,
  beforeHash: operation.beforeHash, afterHash: operation.afterHash});

/** Durable write-ahead receipts. Progress updates are small; the adopted after-state is sealed once after host admission. */
export class WorkspaceReceiptStore {
  constructor({directory, maxEntries = 32, maxSnapshotBytes = 256 * 1024 * 1024}) {
    Object.assign(this, {directory, maxEntries, maxSnapshotBytes});
    this.prepared = new WeakMap();
    this.disposed = false;
    this.sequence = 0;
  }

  async save(receipt, {signal} = {}) {
    if (this.disposed) throw new Error('SFW1130: Transaction receipt store is disposed');
    throwIfWorkspaceAborted(signal);
    if (!Number.isSafeInteger(receipt.id) || receipt.id < 1) throw new Error('SFW1130: Invalid transaction identity');
    let entry = this.prepared.get(receipt);
    if (!entry) {
      const before = await this.snapshot(receipt.before, {signal});
      // The app derives new baseline/dirty ownership only during adoption. Do not persist obsolete pre-operation document states.
      const {documentStates, ...staged} = receipt.after;
      const after = await this.snapshot(staged, {signal});
      if ((before.length + after.length) * 2 > this.maxSnapshotBytes) throw new Error('SFW1131: Transaction snapshot byte budget exceeded');
      const name = await this.allocateName(receipt.id, signal);
      const directory = await this.directory.getDirectoryHandle(name, {create: true});
      await writeRecoveryText(directory, 'before.json', before, signal);
      await writeRecoveryText(directory, 'after.json', after, signal);
      entry = {name, directory, beforeBytes: before.length * 2, sealed: false};
      this.prepared.set(receipt, entry);
    }
    if (receipt.status.startsWith('committed') && !entry.sealed) {
      const after = await this.snapshot(receipt.after, {signal});
      if (entry.beforeBytes + after.length * 2 > this.maxSnapshotBytes) throw new Error('SFW1131: Transaction snapshot byte budget exceeded');
      await writeRecoveryText(entry.directory, 'after.json', after, signal);
      entry.sealed = true;
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

  snapshot(state, {signal}) {
    const records = state.records.filter(record => !unloaded(record));
    const paths = new Set(records.map(record => record.path));
    const documentStates = state.documentStates ? new Map([...state.documentStates].filter(([path]) => paths.has(path))) : undefined;
    return encodeRecoveryRecord({...state, records, documentStates}, {signal, maxBytes: this.maxSnapshotBytes});
  }

  async allocateName(id, signal) {
    // Journal ids are local to a journal instance. A restarted journal must not overwrite the last durable receipt.
    this.sequence = Math.max(this.sequence, id - 1);
    let count = 0;
    for await (const [name] of this.directory.entries()) {
      throwIfWorkspaceAborted(signal);
      if (++count > 4096) throw new Error('SFW1131: Transaction directory entry limit exceeded');
      if (/^transaction-[1-9]\d{0,15}$/.test(name)) this.sequence = Math.max(this.sequence, Number(name.slice(12)));
    }
    if (!Number.isSafeInteger(this.sequence + 1)) throw new Error('SFW1131: Transaction receipt identity space exhausted');
    return 'transaction-' + ++this.sequence;
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
    const before = await decodeRecoveryRecord(await readRecoveryText(directory, 'before.json'), {signal, maxBytes: this.maxSnapshotBytes});
    const after = await decodeRecoveryRecord(await readRecoveryText(directory, 'after.json'), {signal, maxBytes: this.maxSnapshotBytes});
    return {...envelope.payload, before: {...before, records: [...before.records, ...envelope.payload.beforeUnloaded]},
      after: {...after, records: [...after.records, ...envelope.payload.afterUnloaded]}};
  }

  dispose() { this.disposed = true; this.prepared = new WeakMap(); }
}
