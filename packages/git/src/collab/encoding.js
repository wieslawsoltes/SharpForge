import { GitError, checkLimit } from '../errors.js';
import { COLLAB_LIMITS, COLLAB_PROTOCOL_VERSION, validateUpdate, collaborationLimits, validateIdentityPart } from './validation.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Encode a versioned update. JSON preserves individual UTF-16 surrogate units exactly. */
export function encodeCollaborationUpdate(update, limits = COLLAB_LIMITS) {
  limits = collaborationLimits(limits);
  return encodeJson(validateUpdate(update, limits), limits.maxUpdateBytes);
}

export function decodeCollaborationUpdate(bytes, limits = COLLAB_LIMITS) {
  limits = collaborationLimits(limits);
  return validateUpdate(decodeJson(bytes, limits.maxUpdateBytes), limits);
}

export function encodeCollaborationSnapshot(snapshot, limits = COLLAB_LIMITS) {
  limits = collaborationLimits(limits);
  validateSnapshotHeader(snapshot, limits);
  return encodeJson(snapshot, limits.maxSnapshotBytes);
}

export function decodeCollaborationSnapshot(bytes, limits = COLLAB_LIMITS) {
  limits = collaborationLimits(limits);
  const snapshot = decodeJson(bytes, limits.maxSnapshotBytes);
  validateSnapshotHeader(snapshot, limits);
  return snapshot;
}

export function validateSnapshotHeader(snapshot, limits = COLLAB_LIMITS) {
  if (!snapshot || snapshot.type !== 'snapshot' || snapshot.version !== COLLAB_PROTOCOL_VERSION || !Array.isArray(snapshot.updates)) {
    throw new GitError('Corrupt', 'Unsupported collaboration snapshot');
  }
  checkLimit(snapshot.updates.length, limits.maxOperations, 'CRDT snapshot operations');
  validateIdentityPart(snapshot.workspaceId, 'Snapshot workspace');
  validateIdentityPart(snapshot.documentId, 'Snapshot document');
}

export function encodeJson(value, maximum) {
  let json;
  try { json = JSON.stringify(value); }
  catch { throw new GitError('Corrupt', 'Collaboration value cannot be encoded as JSON'); }
  if (typeof json !== 'string') throw new GitError('Corrupt', 'Collaboration value cannot be encoded as JSON');
  checkLimit(json.length, maximum, 'Collaboration JSON characters');
  const bytes = encoder.encode(json);
  checkLimit(bytes.byteLength, maximum, 'Collaboration message bytes');
  return bytes;
}

export function decodeJson(input, maximum) {
  let json;
  if (typeof input === 'string') {
    checkLimit(input.length, maximum, 'Collaboration message characters');
    checkLimit(encoder.encode(input).byteLength, maximum, 'Collaboration message bytes');
    json = input;
  } else {
    const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
    if (!bytes) throw new GitError('Corrupt', 'Collaboration message must contain text or UTF-8 bytes');
    checkLimit(bytes.byteLength, maximum, 'Collaboration message bytes');
    try {
      json = decoder.decode(bytes);
    } catch {
      throw new GitError('Corrupt', 'Collaboration message is not valid UTF-8');
    }
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new GitError('Corrupt', 'Collaboration message is not valid JSON');
  }
}
