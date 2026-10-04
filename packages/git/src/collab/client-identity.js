import { GitError } from '../errors.js';
import { validateIdentityPart } from './validation.js';

/** A tab retains its actor across reload; Web Locks forks cloned-tab identities before they can reuse clocks. */
export async function acquireCollaborationClient(options) {
  const { workspaceId, roomId, documentId } = options;
  for (const value of [workspaceId, roomId, documentId]) validateIdentityPart(value);
  let storage;
  try {
    storage = options.storage ?? globalThis.sessionStorage;
  } catch {
    throw new GitError('Unsupported', 'Collaboration client identity storage is unavailable');
  }
  const locks = options.locks ?? globalThis.navigator?.locks;
  const crypto = options.crypto ?? globalThis.crypto;
  if (!storage || !locks?.request || !crypto?.randomUUID) {
    throw new GitError('Unsupported', 'Automatic reload-safe collaboration identity requires session storage, Web Locks and secure randomness');
  }
  const key = 'sharpforge.collab.client.' + JSON.stringify([workspaceId, roomId, documentId]);
  let actor;
  try {
    actor = storage.getItem(key);
  } catch {
    throw new GitError('Unsupported', 'Collaboration client identity storage is unavailable');
  }
  if (actor) validateIdentityPart(actor, 'Stored collaboration actor');
  for (let attempt = 0; attempt < 5; attempt++) {
    actor ??= crypto.randomUUID();
    const lease = await acquireLock(locks, key + ':' + actor);
    if (!lease) { actor = null; continue; }
    try {
      storage.setItem(key, actor);
    } catch {
      lease.release();
      throw new GitError('Quota', 'Collaboration client identity could not be saved for reload');
    }
    return Object.freeze({ clientId: actor, release: lease.release });
  }
  throw new GitError('Conflict', 'A unique collaboration client identity could not be reserved');
}

function acquireLock(locks, name) {
  let release;
  let resolve;
  let reject;
  const held = new Promise(done => { release = done; });
  const acquired = new Promise((done, failed) => { resolve = done; reject = failed; });
  void locks.request(name, { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) { resolve(null); return; }
    resolve({ release });
    await held;
  }).catch(() => reject(new GitError('Conflict', 'Collaboration client lock could not be acquired')));
  return acquired;
}
