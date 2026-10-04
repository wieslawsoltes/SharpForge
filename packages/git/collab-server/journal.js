import { createHash } from 'node:crypto';
import { mkdir, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { GitError, checkLimit } from '../src/errors.js';
import { collaborationLimits, validateUpdate, sameDocument, roomKey, COLLAB_PROTOCOL_VERSION } from '../src/collab/validation.js';

/** Single-server append journal. sync() completes before acknowledgment; room paths are content-addressed. */
export class FileCollaborationJournal {
  constructor({ directory, limits }) {
    if (typeof directory !== 'string' || !directory) throw new TypeError('A journal directory is required');
    this.directory = directory;
    this.limits = collaborationLimits(limits);
  }

  #path(identity) {
    const digest = createHash('sha256').update(roomKey(identity)).digest('hex');
    return join(this.directory, digest + '.jsonl');
  }

  async load(identity) {
    let file;
    try {
      file = await open(this.#path(identity), 'r');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new GitError('Network', 'Collaboration journal cannot be opened');
    }
    try {
      const info = await file.stat();
      checkLimit(info.size, this.limits.maxHistoryBytes + this.limits.maxOperations, 'Collaboration journal bytes');
      const text = await file.readFile('utf8');
      const updates = [];
      for (const line of text.split('\n')) {
        if (!line) continue;
        let value;
        try { value = JSON.parse(line); }
        catch { throw new GitError('Corrupt', 'Collaboration journal contains an incomplete operation'); }
        const update = validateUpdate(value, this.limits);
        if (!sameDocument(update, identity)) throw new GitError('Auth', 'Collaboration journal document mismatch');
        updates.push(update);
        checkLimit(updates.length, this.limits.maxOperations, 'Collaboration journal operations');
      }
      return { type: 'snapshot', version: COLLAB_PROTOCOL_VERSION, workspaceId: identity.workspaceId, documentId: identity.documentId, updates };
    } finally {
      await file.close();
    }
  }

  async append(identity, input) {
    const update = validateUpdate(input, this.limits);
    if (!sameDocument(identity, update)) throw new GitError('Auth', 'Journal update belongs to another document');
    const line = JSON.stringify(update) + '\n';
    const bytes = Buffer.byteLength(line, 'utf8');
    checkLimit(bytes, this.limits.maxUpdateBytes + 1, 'Collaboration journal operation bytes');
    await mkdir(this.directory, { recursive: true });
    const path = this.#path(identity);
    let previous = 0;
    try { previous = (await stat(path)).size; }
    catch (error) { if (error.code !== 'ENOENT') throw new GitError('Network', 'Collaboration journal cannot be inspected'); }
    checkLimit(previous + bytes, this.limits.maxHistoryBytes + this.limits.maxOperations, 'Collaboration journal bytes');
    const file = await open(path, 'a', 0o600);
    try {
      await file.writeFile(line, 'utf8');
      await file.sync();
    } catch (error) {
      throw new GitError(error.code === 'ENOSPC' ? 'Quota' : 'Network', 'Collaboration journal write was not acknowledged');
    } finally {
      await file.close();
    }
  }
}
