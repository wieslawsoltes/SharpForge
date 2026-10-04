import {hashWorkspaceBytes, throwIfWorkspaceAborted} from '../content-hash.js';

export class WorkspaceSaveConflict extends Error {
  constructor(path, expectedHash, actualHash) {
    super('SFW1411: File changed before save: ' + path);
    this.name = 'WorkspaceSaveConflict';
    Object.assign(this, {code: 'SFW1411', path, expectedHash, actualHash});
  }
}

/** Web Locks serialize save admission; exact on-disk hashes are re-read while holding ownership. */
export class WorkspaceSaveLocks {
  constructor({identity, locks = globalThis.navigator?.locks} = {}) {
    if (typeof identity !== 'string' || !identity) throw new Error('SFW1410: Workspace identity is required');
    Object.assign(this, {identity, locks});
    this.disposed = false;
    this.abort = new AbortController();
  }

  async run(path, action, {signal, workspace = false} = {}) {
    if (this.disposed) throw new Error('SFW1412: Save coordinator is disposed');
    if (!this.locks?.request) throw new Error('SFW1413: Cross-window save ownership requires Web Locks');
    const combined = signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal;
    throwIfWorkspaceAborted(combined);
    const scope = JSON.stringify(['sharpforge-save', this.identity, '*']);
    const key = JSON.stringify(['sharpforge-save', this.identity, path]);
    return this.locks.request(scope, {mode: workspace ? 'exclusive' : 'shared', signal: combined}, async () => {
      throwIfWorkspaceAborted(combined);
      if (workspace) return action({signal: combined});
      return this.locks.request(key, {mode: 'exclusive', signal: combined}, async () => {
        throwIfWorkspaceAborted(combined);
        return action({signal: combined});
      });
    });
  }

  async guardedSave({path, expectedHash, read, write, signal}) {
    if (typeof expectedHash !== 'string' && expectedHash !== null) throw new TypeError('The expected byte hash is required');
    return this.run(path, async ({signal: heldSignal}) => {
      const bytes = await read({signal: heldSignal});
      const actualHash = bytes === null ? null : await hashWorkspaceBytes(bytes, {signal: heldSignal});
      if (actualHash !== expectedHash) throw new WorkspaceSaveConflict(path, expectedHash, actualHash);
      throwIfWorkspaceAborted(heldSignal);
      return write({signal: heldSignal});
    }, {signal});
  }

  dispose() {
    this.disposed = true;
    this.abort.abort(new DOMException('Save coordinator disposed', 'AbortError'));
  }
}
