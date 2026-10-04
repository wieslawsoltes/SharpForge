import {normalizePath} from '../paths.js';
import {encodeWorkspaceFile} from '@sharpforge/archive';
import {diskLimits} from './limits.js';
import {isTextRecord, recordSource, isSourceSnapshot, cloneWorkspaceRecord} from '../workspace-records.js';
import {readWorkspaceFile, sourceReaderOptions, decodeKnownSource, checkReadCancellation} from './source-reader.js';
import {contentLength, initialRecordSize, sourceByteLength, equalSourceContent, writeSourceContent, updateSavedRecord} from './source-content.js';
import {captureBaselineObservation, acceptBaselineObservation} from './baseline-observation.js';

async function currentText(handle, path, limits, {encoding, signal}) {
  const file = await handle.getFile();
  checkReadCancellation(signal);
  if (file.size > limits.maxAssemblyBytes) throw new Error('Disk workspace byte limit exceeded by ' + path);
  if (typeof file.arrayBuffer === 'function') {
    const decoded = decodeKnownSource(path, new Uint8Array(await file.arrayBuffer()), encoding);
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
    this.readSource = sourceReaderOptions({readSource: options.readSource ?? records.readSource}).readSource;
    this.byPath = new Map(records.map(record => [record.path, record]));
    this.baseline = new Map(records.filter(isTextRecord).map(record => [record.path, recordSource(record) ?? record.text]));
    this.sizes = new Map(records.map(record => [record.path, initialRecordSize(record)]));
    this.versions = new Map(records.map(record => [record.path, record.version ?? 0]));
    this.saveState = {queue: Promise.resolve()};
  }

  getVersion(path) { return this.versions.get(normalizePath(path)) ?? 0; }

  /** Accept confirmed external text in save order; commit(accept) joins synchronous host state before notifications. */
  acceptBaseline(path, observed, options = {}) {
    let captured;
    try { captured = captureBaselineObservation(path, observed, options); }
    catch (error) { return Promise.reject(error); }
    const task = this.saveState.queue.then(() => acceptBaselineObservation(this, captured));
    this.saveState.queue = task.catch(() => {});
    return task;
  }

  /** Stage URI rebasing with the same granted handles and conflict baselines; the original workspace stays unchanged. */
  rebasePaths(pathMap, records, folders = this.folders) {
    if (!(pathMap instanceof Map) || !Array.isArray(records)) throw new TypeError('Disk rebasing requires a path map and records');
    const replacements = new Map(records.map(record => [record.path, record]));
    const paths = new Map();
    const used = new Set();
    const mapped = this.records.map(record => {
      const path = normalizePath(pathMap.get(record.path) ?? record.path);
      if (used.has(path)) throw new Error('Duplicate rebased disk path: ' + path);
      used.add(path);
      paths.set(record.path, path);
      const replacement = replacements.get(path);
      if (!replacement && path !== record.path && recordSource(record)) {
        throw new TypeError('Rebased prepared source record is missing: ' + path);
      }
      return replacement ?? cloneWorkspaceRecord(record, path);
    });
    const handles = new Map([...this.handles].map(([path, handle]) => [paths.get(path) ?? path, handle]));
    const next = new DiskWorkspace(mapped, handles, this.name, folders, this.skipped, {...this.limits, readSource: this.readSource});
    next.baseline = new Map([...this.baseline].map(([path, source]) => [paths.get(path) ?? path, source]));
    next.sizes = new Map([...this.sizes].map(([path, bytes]) => [paths.get(path) ?? path, bytes]));
    next.versions = new Map([...this.versions].map(([path, version]) => [paths.get(path) ?? path, version]));
    next.saveState = this.saveState;
    return next;
  }

  /** Serialize explicit saves; stale requested versions and external changes fail before any write stream. */
  save(changes, {signal} = {}) {
    if (!Array.isArray(changes)) return Promise.reject(new TypeError('Save changes must be an array'));
    const copied = changes.map(change => ({path: change.path ?? change.uri,
      content: change.source ?? change.text, expectedVersion: change.expectedVersion}));
    const task = this.saveState.queue.then(() => this.saveChanges(copied, {signal}));
    this.saveState.queue = task.catch(() => {});
    return task;
  }

  async saveChanges(changes, {signal} = {}) {
    checkReadCancellation(signal);
    const seen = new Set();
    const pending = [];
    let total = [...this.sizes.values()].reduce((sum, size) => sum + size, 0);
    for (const change of changes) {
      checkReadCancellation(signal);
      const path = normalizePath(change.path);
      if (seen.has(path)) throw new Error('Duplicate save path');
      seen.add(path);
      if (contentLength(change.content) > this.limits.maxFileBytes) throw new Error('Invalid save text');
      const record = this.byPath.get(path) ?? {path};
      const bytes = await sourceByteLength(change.content, record, this.limits.maxFileBytes, {signal});
      if (bytes > this.limits.maxFileBytes || bytes > this.limits.maxAssemblyBytes) throw new Error('Source file limit exceeded by ' + path);
      total += bytes - (this.sizes.get(path) ?? 0);
      const handle = this.handles.get(path);
      if (!handle) throw new Error(`No write handle for '${path}'; export or reopen its folder.`);
      this.checkVersion(path, change.expectedVersion);
      await this.checkBaseline(path, handle, {signal});
      pending.push({path, content: change.content, record, handle, bytes, expectedVersion: change.expectedVersion});
    }
    if (total > this.limits.maxTotalBytes) throw new Error('Disk workspace total byte limit exceeded; no files were written.');
    for (const file of pending) await this.permission(file, {signal});
    // Permission prompts can yield long enough for another application to modify the source.
    for (const file of pending) {
      checkReadCancellation(signal);
      this.checkVersion(file.path, file.expectedVersion);
      await this.checkBaseline(file.path, file.handle, {signal});
    }
    return this.writeFiles(pending, {signal});
  }

  checkVersion(path, expectedVersion) {
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion !== this.getVersion(path))) {
      throw new Error(`Disk version conflict in '${path}'; no files were written.`);
    }
  }

  async checkBaseline(path, handle, {signal} = {}) {
    checkReadCancellation(signal);
    let matches;
    const encoding = this.byPath.get(path)?.encoding;
    if (this.readSource && /\.cs$/i.test(path)) {
      const file = await handle.getFile();
      const prepared = await readWorkspaceFile(file, path, this.limits, {readSource: this.readSource, encoding, signal});
      try { matches = await equalSourceContent(prepared.source, this.baseline.get(path), {signal}); }
      finally { prepared.model.dispose(); }
    } else {
      const current = await currentText(handle, path, this.limits, {encoding, signal});
      const baseline = this.baseline.get(path);
      matches = isSourceSnapshot(baseline) ? await equalSourceContent(current, baseline, {signal}) : current === baseline;
    }
    checkReadCancellation(signal);
    if (!matches) {
      throw new Error(`Disk conflict in '${path}'; no files were written. Reopen the folder before saving.`);
    }
  }

  async permission(file, {signal} = {}) {
    checkReadCancellation(signal);
    if (typeof file.handle.queryPermission !== 'function') return;
    let permission = await file.handle.queryPermission({mode: 'readwrite'});
    checkReadCancellation(signal);
    if (permission !== 'granted' && typeof file.handle.requestPermission === 'function') {
      permission = await file.handle.requestPermission({mode: 'readwrite'});
      checkReadCancellation(signal);
    }
    if (permission !== 'granted') throw new Error(`Write permission denied for '${file.path}'; no files were written.`);
  }

  async writeFiles(pending, {signal} = {}) {
    const written = [];
    for (const file of pending) {
      let stream;
      try {
        checkReadCancellation(signal);
        stream = await file.handle.createWritable();
        checkReadCancellation(signal);
        if (isSourceSnapshot(file.content)) await writeSourceContent(stream, file.content, {
          path: file.path, encoding: file.record.encoding, bom: file.record.bom, maxBytes: this.limits.maxFileBytes, signal
        });
        else {
          const record = file.record;
          const content = record.bytes || record.encoding || record.bom
            ? encodeWorkspaceFile({path: file.path, text: file.content, encoding: record.encoding, bom: record.bom}) : file.content;
          await stream.write(content);
        }
        checkReadCancellation(signal);
        await stream.close();
        written.push(file.path);
        this.baseline.set(file.path, file.content);
        this.sizes.set(file.path, file.bytes);
        this.versions.set(file.path, this.getVersion(file.path) + 1);
        if (this.byPath.has(file.path)) updateSavedRecord(file.record, file.content, file.bytes);
      } catch (error) {
        try { await stream?.abort(); } catch { /* The original write error remains authoritative. */ }
        const failure = new Error(`Save failed for '${file.path}'. Written before failure: ${written.join(', ') || 'none'}. ${error.message}`);
        failure.name = error.name;
        if (error.code) failure.code = error.code;
        failure.cause = error;
        failure.written = written;
        throw failure;
      }
    }
    return {written, atomic: false};
  }
}
