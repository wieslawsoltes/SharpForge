import {normalizePath} from './paths.js';
import {decodeWorkspaceFile, encodeWorkspaceFile} from '@sharpforge/archive';

async function currentText(handle, path) {
  const file = await handle.getFile();
  if (typeof file.arrayBuffer === 'function') {
    const decoded = decodeWorkspaceFile(path, new Uint8Array(await file.arrayBuffer()));
    if (typeof decoded.text !== 'string') throw new Error('Disk source changed to binary: ' + path);
    return decoded.text;
  }
  return file.text();
}

/** Existing explicit-save workspace, extracted without changing its public behavior. */
export class DiskWorkspace {
  constructor(records, handles = new Map(), name = 'Selected files', folders = [], skipped = []) {
    this.records = records;
    this.handles = handles;
    this.name = name;
    this.folders = folders;
    this.skipped = skipped;
    this.baseline = new Map(records.filter(file => typeof file.text === 'string').map(file => [file.path, file.text]));
  }

  /** Preflight every file and report completed writes; multi-file I/O is not atomic. */
  async save(changes) {
    const seen = new Set();
    const pending = [];
    for (const change of changes) {
      const path = normalizePath(change.path ?? change.uri);
      if (seen.has(path)) throw new Error('Duplicate save path');
      seen.add(path);
      if (typeof change.text !== 'string' || change.text.length > 2_000_000) throw new Error('Invalid save text');
      const handle = this.handles.get(path);
      if (!handle) throw new Error(`No write handle for '${path}'; export or reopen its folder.`);
      const current = await currentText(handle, path);
      if (current !== this.baseline.get(path)) {
        throw new Error(`Disk conflict in '${path}'; no files were written. Reopen the folder before saving.`);
      }
      pending.push({path, text: change.text, handle});
    }
    // Resolve all permissions before opening any stream, then recheck after user prompts.
    for (const file of pending) {
      if (typeof file.handle.queryPermission !== 'function') continue;
      let permission = await file.handle.queryPermission({mode: 'readwrite'});
      if (permission !== 'granted' && typeof file.handle.requestPermission === 'function') {
        permission = await file.handle.requestPermission({mode: 'readwrite'});
      }
      if (permission !== 'granted') throw new Error(`Write permission denied for '${file.path}'; no files were written.`);
    }
    for (const file of pending) {
      if (await currentText(file.handle, file.path) !== this.baseline.get(file.path)) {
        throw new Error(`Disk conflict in '${file.path}'; no files were written. Reopen the folder before saving.`);
      }
    }
    const written = [];
    for (const file of pending) {
      let stream;
      try {
        stream = await file.handle.createWritable();
        const original = this.records.find(record => record.path === file.path);
        const content = original?.bytes ? encodeWorkspaceFile({...original, text: file.text}) : file.text;
        await stream.write(content);
        await stream.close();
        written.push(file.path);
        this.baseline.set(file.path, file.text);
        const record = this.records.find(value => value.path === file.path);
        if (record) record.text = file.text;
      } catch (error) {
        try { await stream?.abort(); } catch {}
        const failure = new Error(`Save failed for '${file.path}'. Written before failure: ${written.join(', ') || 'none'}. ${error.message}`);
        failure.written = written;
        throw failure;
      }
    }
    return {written, atomic: false};
  }
}
