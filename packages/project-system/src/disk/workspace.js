import {normalizePath} from '../paths.js';
import {decodeWorkspaceFile, encodeWorkspaceFile} from '@sharpforge/archive';
import {diskLimits, encodedLength} from './limits.js';

async function currentText(handle, path, limits) {
  const file = await handle.getFile();
  if (file.size > limits.maxAssemblyBytes) throw new Error('Disk workspace byte limit exceeded by ' + path);
  if (typeof file.arrayBuffer === 'function') {
    const decoded = decodeWorkspaceFile(path, new Uint8Array(await file.arrayBuffer()));
    if (typeof decoded.text !== 'string') throw new Error('Disk source changed to binary: ' + path);
    return decoded.text;
  }
  return file.text();
}

export class DiskWorkspace {
  constructor(records, handles = new Map(), name = 'Selected files', folders = [], skipped = [], options = records.limits ?? {}) {
    this.records = records;
    this.handles = handles;
    this.name = name;
    this.folders = folders;
    this.skipped = skipped;
    this.limits = diskLimits(options);
    this.baseline = new Map(records.filter(record => typeof record.text === 'string').map(record => [record.path, record.text]));
    this.sizes = new Map(records.map(record => [record.path, encodedLength(record)]));
    this.versions = new Map(records.map(record => [record.path, record.version ?? 0]));
    this.saveQueue = Promise.resolve();
  }

  getVersion(path) { return this.versions.get(normalizePath(path)) ?? 0; }

  /** Serialize explicit saves; stale requested versions and external changes fail before any write stream. */
  save(changes) {
    if (!Array.isArray(changes)) return Promise.reject(new TypeError('Save changes must be an array'));
    const copied = changes.map(change => ({...change}));
    const task = this.saveQueue.then(() => this.saveChanges(copied));
    this.saveQueue = task.catch(() => {});
    return task;
  }

  async saveChanges(changes) {
    const seen = new Set();
    const pending = [];
    let total = [...this.sizes.values()].reduce((sum, size) => sum + size, 0);
    for (const change of changes) {
      const path = normalizePath(change.path ?? change.uri);
      if (seen.has(path)) throw new Error('Duplicate save path');
      seen.add(path);
      if (typeof change.text !== 'string' || change.text.length > this.limits.maxFileBytes) throw new Error('Invalid save text');
      const record = this.records.find(item => item.path === path) ?? {path};
      const bytes = encodedLength(record, change.text);
      if (bytes > this.limits.maxFileBytes || bytes > this.limits.maxAssemblyBytes) throw new Error('Source file limit exceeded by ' + path);
      total += bytes - (this.sizes.get(path) ?? 0);
      const handle = this.handles.get(path);
      if (!handle) throw new Error(`No write handle for '${path}'; export or reopen its folder.`);
      this.checkVersion(path, change.expectedVersion);
      await this.checkBaseline(path, handle);
      pending.push({path, text: change.text, handle, bytes, expectedVersion: change.expectedVersion});
    }
    if (total > this.limits.maxTotalBytes) throw new Error('Disk workspace total byte limit exceeded; no files were written.');
    for (const file of pending) await this.permission(file);
    // Permission prompts can yield long enough for another application to modify the source.
    for (const file of pending) {
      this.checkVersion(file.path, file.expectedVersion);
      await this.checkBaseline(file.path, file.handle);
    }
    return this.writeFiles(pending);
  }

  checkVersion(path, expectedVersion) {
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion !== this.getVersion(path))) {
      throw new Error(`Disk version conflict in '${path}'; no files were written.`);
    }
  }

  async checkBaseline(path, handle) {
    if (await currentText(handle, path, this.limits) !== this.baseline.get(path)) {
      throw new Error(`Disk conflict in '${path}'; no files were written. Reopen the folder before saving.`);
    }
  }

  async permission(file) {
    if (typeof file.handle.queryPermission !== 'function') return;
    let permission = await file.handle.queryPermission({mode: 'readwrite'});
    if (permission !== 'granted' && typeof file.handle.requestPermission === 'function') {
      permission = await file.handle.requestPermission({mode: 'readwrite'});
    }
    if (permission !== 'granted') throw new Error(`Write permission denied for '${file.path}'; no files were written.`);
  }

  async writeFiles(pending) {
    const written = [];
    for (const file of pending) {
      let stream;
      try {
        stream = await file.handle.createWritable();
        const record = this.records.find(item => item.path === file.path);
        const content = record?.bytes ? encodeWorkspaceFile({...record, text: file.text}) : file.text;
        await stream.write(content);
        await stream.close();
        written.push(file.path);
        this.baseline.set(file.path, file.text);
        this.sizes.set(file.path, file.bytes);
        this.versions.set(file.path, this.getVersion(file.path) + 1);
        if (record) record.text = file.text;
      } catch (error) {
        try { await stream?.abort(); } catch { /* The original write error remains authoritative. */ }
        const failure = new Error(`Save failed for '${file.path}'. Written before failure: ${written.join(', ') || 'none'}. ${error.message}`);
        failure.written = written;
        throw failure;
      }
    }
    return {written, atomic: false};
  }
}
