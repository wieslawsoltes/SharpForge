import {hashWorkspaceBytes, workspaceRecordBytes, throwIfWorkspaceAborted} from '../content-hash.js';
import {reconcileWorkspaceFile} from '../reconcile.js';

/** Explicit cross-window resolution. Divergent buffers remain intact until a chosen result is committed by the host. */
export class WorkspaceConflictCoordinator {
  constructor({getDocument, applyResolution, channel, readLocal = async document => document}) {
    Object.assign(this, {getDocument, applyResolution, channel, readLocal});
    this.conflicts = new Map();
    this.pending = new Map();
  }

  observe(remote) {
    const local = this.getDocument(remote.path);
    if (!local) return null;
    const observation = structuredClone(remote);
    const pending = this.pending.get(remote.path);
    if (pending) pending.latest = observation;
    if (local.hash === remote.hash) { this.conflicts.delete(remote.path); return null; }
    const conflict = {path: remote.path, local: structuredClone(local), remote: observation,
      choices: ['adopt-newer', 'keep-mine', 'merge']};
    this.conflicts.set(remote.path, conflict);
    return conflict;
  }

  async resolve(path, choice, {readRemote, signal} = {}) {
    throwIfWorkspaceAborted(signal);
    const conflict = this.conflicts.get(path);
    if (!conflict) throw new Error('SFW1420: No cross-window conflict for ' + path);
    if (!['adopt-newer', 'keep-mine', 'merge'].includes(choice)) throw new Error('SFW1421: Select an explicit conflict resolution');
    if (this.pending.has(path)) throw new Error('SFW1425: A document conflict resolution is already in progress');
    const request = {latest: conflict.remote};
    this.pending.set(path, request);
    try { return await this.resolvePrepared(conflict, choice, {readRemote, signal, request}); }
    finally { this.pending.delete(path); }
  }

  async resolvePrepared(conflict, choice, {readRemote, signal, request}) {
    const {path} = conflict;
    const observed = this.getDocument(path);
    if (!observed || observed.revision !== conflict.local.revision || observed.hash !== conflict.local.hash) {
      throw new Error('SFW1422: Local document changed while resolving its conflict');
    }
    // A host may mutate its live document in place while remote bytes are read.
    const local = await this.readLocal(structuredClone(observed), {signal});
    throwIfWorkspaceAborted(signal);
    if (!local || local.revision !== observed.revision || local.hash !== observed.hash) {
      throw new Error('SFW1422: Local document changed while reading its conflict contents');
    }
    const remote = await readRemote(conflict.remote, {signal});
    const remoteContent = remote.content ?? remote.text ?? remote.bytes;
    const remoteBytes = remote.bytes ?? (typeof remoteContent === 'string' ? workspaceRecordBytes({...remote, text: remoteContent}) : remoteContent);
    if (await hashWorkspaceBytes(remoteBytes, {signal}) !== conflict.remote.hash) {
      throw new Error('SFW1422: Remote document changed while resolving its conflict');
    }
    const result = reconcileWorkspaceFile({path, base: local.baseContent, mine: local.content,
      theirs: remoteContent, choice: choice === 'adopt-newer' ? 'take-theirs' : choice}, {signal});
    if (result.status === 'conflict' || result.status === 'choice-required') return result;
    const revision = Math.max(local.revision, conflict.remote.revision) + 1;
    const bytes = typeof result.content === 'string' ? workspaceRecordBytes({...local, text: result.content}) : result.content.slice();
    const hash = await hashWorkspaceBytes(bytes, {signal});
    if (request.latest !== conflict.remote) throw new Error('SFW1422: Remote document changed during merge');
    const current = this.getDocument(path);
    if (!current || current.revision !== local.revision || current.hash !== local.hash) throw new Error('SFW1422: Local document changed during merge');
    await this.applyResolution({path, content: result.content, bytes, revision, hash, expectedLocalHash: local.hash,
      expectedLocalRevision: local.revision, baseHash: conflict.remote.hash, choice}, {signal});
    const newest = request.latest;
    if (newest !== conflict.remote) this.observe(newest);
    else this.conflicts.delete(path);
    const pendingConflict = this.conflicts.has(path);
    this.channel.publishRevision({path, revision, hash, baseHash: conflict.remote.hash, resolution: choice});
    return {...result, revision, hash, pendingConflict};
  }
}
