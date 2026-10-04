import { GitError, checkLimit } from '../errors.js';

export const COLLAB_PROTOCOL_VERSION = 1;
export const COLLAB_LIMITS = Object.freeze({
  maxNodes: 1_000_000,
  maxOperations: 250_000,
  maxPendingNodes: 100_000,
  maxUpdateUnits: 65_536,
  maxUpdateBytes: 2 * 1024 * 1024,
  maxSnapshotBytes: 64 * 1024 * 1024,
  maxHistoryBytes: 64 * 1024 * 1024
});

export function collaborationLimits(options = {}) {
  const limits = { ...COLLAB_LIMITS, ...options };
  for (const [name, value] of Object.entries(limits)) checkLimit(value, Number.MAX_SAFE_INTEGER, name);
  return Object.freeze(limits);
}

/** Identifiers are opaque, bounded strings; they are never interpreted as filesystem paths. */
export function validateIdentityPart(value, name = 'Collaboration identity') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.@-]{1,128}$/.test(value)) {
    throw new GitError('Corrupt', name + ' must contain 1–128 safe ASCII characters');
  }
  return value;
}

export function validateIdentity(value) {
  if (!value || typeof value !== 'object') throw new GitError('Corrupt', 'Missing collaboration identity');
  const identity = {};
  for (const name of ['workspaceId', 'roomId', 'documentId', 'clientId']) {
    identity[name] = validateIdentityPart(value[name], name);
  }
  return Object.freeze(identity);
}

export function sameDocument(left, right) {
  return left.workspaceId === right.workspaceId && left.documentId === right.documentId;
}

export function sameRoom(left, right) {
  return sameDocument(left, right) && left.roomId === right.roomId;
}

export function sameIdentity(left, right) {
  return sameRoom(left, right) && left.clientId === right.clientId;
}

export function roomKey(identity) {
  return JSON.stringify([identity.workspaceId, identity.roomId, identity.documentId]);
}

export function parseAtomId(value) {
  if (typeof value !== 'string') throw new GitError('Corrupt', 'Invalid CRDT atom identifier');
  const colon = value.lastIndexOf(':');
  const actor = validateIdentityPart(value.slice(0, colon), 'CRDT actor');
  const clockText = value.slice(colon + 1);
  const clock = Number(clockText);
  if (!/^[1-9][0-9]*$/.test(clockText) || !Number.isSafeInteger(clock)) {
    throw new GitError('Corrupt', 'Invalid CRDT Lamport clock');
  }
  return { actor, clock };
}

export function compareAtoms(left, right) {
  if (left.clock !== right.clock) return right.clock - left.clock;
  return left.actor < right.actor ? 1 : left.actor > right.actor ? -1 : 0;
}

export function validateUpdate(value, limits = COLLAB_LIMITS) {
  if (!value || value.version !== COLLAB_PROTOCOL_VERSION || value.type !== 'update') {
    throw new GitError('Corrupt', 'Unsupported collaboration update version');
  }
  const actorId = validateIdentityPart(value.actorId, 'CRDT actor');
  const workspaceId = validateIdentityPart(value.workspaceId, 'Workspace');
  const documentId = validateIdentityPart(value.documentId, 'Document');
  const operation = parseAtomId(value.id);
  if (operation.actor !== actorId) throw new GitError('Corrupt', 'Operation identity disagrees with its actor');
  if (!Array.isArray(value.inserts) || !Array.isArray(value.deletes)) throw new GitError('Corrupt', 'Invalid CRDT operation lists');
  checkLimit(value.inserts.length + value.deletes.length, limits.maxUpdateUnits, 'CRDT update units');
  if (!value.inserts.length && !value.deletes.length) throw new GitError('Corrupt', 'Empty CRDT update');
  const ids = new Set();
  let previous = null;
  const inserts = value.inserts.map((entry, index) => {
    if (!entry || typeof entry.value !== 'string' || entry.value.length !== 1) {
      throw new GitError('Corrupt', 'CRDT atoms contain exactly one UTF-16 code unit');
    }
    const atom = parseAtomId(entry.id);
    if (atom.actor !== actorId || atom.clock !== operation.clock + index) {
      throw new GitError('Corrupt', 'Inserted atom IDs must form the operation clock range');
    }
    if (entry.parent !== null) {
      const parent = parseAtomId(entry.parent);
      if (parent.clock >= atom.clock) throw new GitError('Corrupt', 'A CRDT parent must causally precede its child');
    }
    if (index && entry.parent !== previous) throw new GitError('Corrupt', 'Inserted text must be one causal chain');
    previous = entry.id;
    ids.add(entry.id);
    return Object.freeze({ id: entry.id, parent: entry.parent, value: entry.value });
  });
  const deleted = new Set();
  const deletes = value.deletes.map(id => {
    const atom = parseAtomId(id);
    if (atom.clock >= operation.clock || ids.has(id) || deleted.has(id)) {
      throw new GitError('Corrupt', 'Deleted atoms must uniquely precede the operation');
    }
    deleted.add(id);
    return id;
  });
  return Object.freeze({
    type: 'update', version: COLLAB_PROTOCOL_VERSION, id: value.id, actorId, workspaceId, documentId,
    inserts: Object.freeze(inserts), deletes: Object.freeze(deletes)
  });
}

export function validateAnchor(value) {
  if (!value || !['left', 'right'].includes(value.bias)) throw new GitError('Corrupt', 'Invalid CRDT selection anchor');
  for (const name of ['left', 'right']) if (value[name] !== null) parseAtomId(value[name]);
  return Object.freeze({ left: value.left, right: value.right, bias: value.bias });
}
