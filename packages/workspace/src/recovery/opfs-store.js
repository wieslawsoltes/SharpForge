import {throwIfWorkspaceAborted} from '../content-hash.js';
import {encodeRecoveryRecord, inspectRecoveryRecord} from './integrity.js';
import {migrateWorkspaceRecovery} from './schema.js';
import {readRecoveryText as readText, writeRecoveryText as writeText} from './io.js';

/** OPFS double-buffered checkpoints; the committed manifest changes only after the inactive snapshot closes successfully. */
export class OpfsRecoveryStore {
  constructor({storage = globalThis.navigator?.storage, directory = null, name = 'sharpforge-recovery', onWarning = () => {}} = {}) {
    Object.assign(this, {storage, directory, name, onWarning});
    this.pending = false;
    this.disposed = false;
    this.diagnostics = [];
  }

  async open() {
    if (this.disposed) throw new Error('SFW1310: Recovery store is disposed');
    if (this.directory) return this.directory;
    if (!this.storage?.getDirectory) throw new Error('SFW1311: OPFS recovery is unavailable');
    const root = await this.storage.getDirectory();
    this.directory = await root.getDirectoryHandle(this.name, {create: true});
    return this.directory;
  }

  async requestPersistence() {
    if (!this.storage?.persist) return {supported: false, persistent: false};
    return {supported: true, persistent: await this.storage.persist()};
  }

  async manifest(directory) {
    const text = await readText(directory, 'current.json');
    if (text === null) return {version: 1, current: null, previous: null, sequence: 0};
    const value = JSON.parse(text);
    if (value.version !== 1 || !Number.isSafeInteger(value.sequence) || value.sequence < 0 ||
        ![null, 'snapshot-0.json', 'snapshot-1.json'].includes(value.current) ||
        ![null, 'snapshot-0.json', 'snapshot-1.json'].includes(value.previous)) throw new Error('SFW1305: Invalid recovery manifest');
    return value;
  }

  async save(value, {signal} = {}) {
    if (this.pending) throw new Error('SFW1312: Recovery save is already in progress');
    this.pending = true;
    try { return await this.saveExclusive(value, {signal}); }
    finally { this.pending = false; }
  }

  async saveExclusive(value, {signal}) {
    const directory = await this.open();
    const current = await this.manifest(directory);
    let record = migrateWorkspaceRecovery(value);
    let text = await encodeRecoveryRecord(record, {signal});
    const estimate = await this.storage?.estimate?.();
    let degraded = false;
    const available = estimate?.quota === undefined ? Infinity : Math.max(0, estimate.quota - (estimate.usage ?? 0));
    if (new TextEncoder().encode(text).length + 4096 > available) {
      const omitted = record.records.filter(file => file.bytes && typeof file.text !== 'string').map(file => file.path);
      record = {...record, omittedBinaryFiles: [...new Set([...record.omittedBinaryFiles, ...omitted])],
        records: record.records.map(({bytes, originalText, ...file}) => typeof file.text === 'string' || file.lazy ? file :
          {...file, lazy: true, size: bytes.length, recoveryMissing: 'quota'})};
      text = await encodeRecoveryRecord(record, {signal});
      degraded = true;
      if (new TextEncoder().encode(text).length + 4096 > available) throw new Error('SFW1313: Insufficient recovery quota; old checkpoint retained');
      const warning = {code: 'SFW1313', message: 'Recovery quota permits text only', omittedBinaryFiles: omitted};
      this.diagnostics.push(warning);
      this.onWarning(warning);
    }
    const next = current.current === 'snapshot-0.json' ? 'snapshot-1.json' : 'snapshot-0.json';
    await writeText(directory, next, text, signal);
    const manifest = {version: 1, current: next, previous: current.current, sequence: current.sequence + 1};
    await writeText(directory, 'current.json', JSON.stringify(manifest), signal);
    return {saved: true, sequence: manifest.sequence, degraded, omittedBinaryFiles: record.omittedBinaryFiles};
  }

  async quarantine({name, text, report}) {
    const directory = await (await this.open()).getDirectoryHandle('quarantine', {create: true});
    await writeText(directory, name, text);
    await writeText(directory, name + '.report.json', JSON.stringify(report));
  }

  async load({signal} = {}) {
    const directory = await this.open();
    let manifest;
    try { manifest = await this.manifest(directory); }
    catch (error) {
      const text = await readText(directory, 'current.json');
      await this.quarantine({name: 'current.json', text: text ?? '', report: {message: error.message}});
      this.diagnostics.push({code: 'SFW1305', message: error.message});
      manifest = {current: 'snapshot-0.json', previous: 'snapshot-1.json'};
    }
    for (const name of [manifest.current, manifest.previous].filter(Boolean)) {
      throwIfWorkspaceAborted(signal);
      const text = await readText(directory, name);
      if (text === null) continue;
      const inspected = await inspectRecoveryRecord(text, {name, signal, quarantine: value => this.quarantine(value)});
      this.diagnostics.push(...inspected.diagnostics);
      if (inspected.record) return {record: inspected.record, diagnostics: [...this.diagnostics], recoveredPrevious: name !== manifest.current};
      if (inspected.preserved) return {record: null, diagnostics: [...this.diagnostics], preserved: true};
    }
    return {record: null, diagnostics: [...this.diagnostics]};
  }

  dispose() { this.disposed = true; }
}
