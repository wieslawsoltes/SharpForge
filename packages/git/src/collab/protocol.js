import { GitError, checkLimit } from '../errors.js';
import { decodeJson, encodeJson } from './encoding.js';
import { COLLAB_PROTOCOL_VERSION, COLLAB_LIMITS, validateAnchor, validateIdentityPart } from './validation.js';

export const CollaborationMessage = Object.freeze({
  Authenticate: 'auth', Ready: 'ready', Error: 'error', SyncRequest: 'sync-request', SyncStart: 'sync-start',
  SyncBatch: 'sync-batch', SyncEnd: 'sync-end', Update: 'update', Acknowledge: 'ack', Presence: 'presence',
  PeerJoined: 'peer-joined', PeerLeft: 'peer-left', Signal: 'signal', Ping: 'ping', Pong: 'pong',
  Initialize: 'initialize', Initialized: 'initialized'
});

export function parseCollaborationMessage(input, limit = COLLAB_LIMITS.maxUpdateBytes) {
  const message = decodeJson(input, limit);
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.version !== COLLAB_PROTOCOL_VERSION) {
    throw new GitError('Corrupt', 'Unsupported collaboration protocol version');
  }
  if (!Object.values(CollaborationMessage).includes(message.type)) throw new GitError('Corrupt', 'Unknown collaboration message');
  return message;
}

export function collaborationMessage(type, fields = {}) {
  return { ...fields, type, version: COLLAB_PROTOCOL_VERSION };
}

export function serializeCollaborationMessage(message, limit = COLLAB_LIMITS.maxUpdateBytes) {
  return new TextDecoder().decode(encodeJson(message, limit));
}

/** Presence carries stable anchors, never full document text or authentication material. */
export function validatePresence(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new GitError('Corrupt', 'Invalid collaboration presence');
  const name = typeof value.name === 'string' ? value.name : '';
  if (name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new GitError('Corrupt', 'Invalid collaboration display name');
  if (typeof value.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.color)) {
    throw new GitError('Corrupt', 'Presence color must be a six-digit hexadecimal RGB value');
  }
  const selection = value.selection === null ? null : {
    anchor: validateAnchor(value.selection?.anchor), focus: validateAnchor(value.selection?.focus)
  };
  return Object.freeze({ name, color: value.color, selection, state: value.state === 'idle' ? 'idle' : 'active' });
}

export function validateSignal(value) {
  if (!value || typeof value !== 'object') throw new GitError('Corrupt', 'Invalid WebRTC signal');
  const sessionId = validateIdentityPart(value.sessionId, 'WebRTC session');
  if (value.request === true) return { sessionId, request: true };
  if (value.description) {
    const { type, sdp } = value.description;
    if (!['offer', 'answer'].includes(type) || typeof sdp !== 'string') throw new GitError('Corrupt', 'Invalid WebRTC description');
    checkLimit(sdp.length, 512 * 1024, 'WebRTC description');
    return { sessionId, description: { type, sdp } };
  }
  if (value.candidate) {
    const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = value.candidate;
    if (typeof candidate !== 'string') throw new GitError('Corrupt', 'Invalid ICE candidate');
    checkLimit(candidate.length, 4096, 'ICE candidate');
    for (const field of [sdpMid, usernameFragment]) {
      if (field !== null && field !== undefined && (typeof field !== 'string' || field.length > 256)) {
        throw new GitError('Corrupt', 'Invalid ICE candidate metadata');
      }
    }
    if (sdpMLineIndex !== null && sdpMLineIndex !== undefined) checkLimit(sdpMLineIndex, 256, 'ICE media index');
    return { sessionId, candidate: { candidate, sdpMid, sdpMLineIndex, usernameFragment } };
  }
  throw new GitError('Corrupt', 'WebRTC signal has no description or candidate');
}

/** Errors from authentication/storage adapters are deliberately not echoed to remote clients. */
export function publicCollaborationFailure(error) {
  const messages = {
    Auth: 'Collaboration authorization failed', Conflict: 'Collaboration identity or operation conflict',
    Limit: 'Collaboration resource limit exceeded', Corrupt: 'Malformed collaboration request',
    Quota: 'Collaboration persistence quota exceeded', Network: 'Collaboration service unavailable',
    Disposed: 'Collaboration session closed', Unsafe: 'Collaboration origin is not granted',
    Unsupported: 'Requested collaboration transport is unavailable'
  };
  const code = Object.hasOwn(messages, error?.code) ? error.code : 'Network';
  return { code, message: messages[code] };
}
