import { GitError, checkLimit } from '../errors.js';
import { collaborationClock, CollaborationEvents } from './events.js';
import { validatePresence } from './protocol.js';
import { validateIdentityPart } from './validation.js';

/** Ephemeral presence uses stable CRDT anchors; room membership owns its lifetime. */
export class CollaborationPresence {
  #remote = new Map();
  #events = new CollaborationEvents();
  #expiryTimer = null;
  #sequence = 0;
  #local;
  #disposed = false;

  constructor({ document, identity, profile = {}, clock, ttlMs = 45000, maxPeers = 1024 }) {
    this.document = document;
    this.identity = identity;
    this.clock = collaborationClock(clock);
    this.ttlMs = ttlMs;
    this.maxPeers = maxPeers;
    checkLimit(ttlMs, 2 ** 31 - 1, 'Collaboration presence lifetime');
    checkLimit(maxPeers, 65536, 'Collaboration presence peers');
    this.#local = validatePresence({ name: profile.name ?? identity.clientId, color: profile.color ?? '#3b82f6', selection: null });
  }

  get local() {
    return this.#local;
  }

  get sequence() {
    return this.#sequence;
  }

  get peers() {
    return [...this.#remote.entries()].map(([clientId, entry]) => {
      const selection = entry.presence.selection;
      return Object.freeze({
        clientId, name: entry.presence.name, color: entry.presence.color, state: entry.presence.state,
        selection: selection ? {
          anchor: this.document.resolveAnchor(selection.anchor), focus: this.document.resolveAnchor(selection.focus)
        } : null
      });
    });
  }

  subscribe(listener) {
    return this.#events.subscribe(listener);
  }

  setLocal({ anchor, focus = anchor, name = this.#local.name, color = this.#local.color, state = 'active' } = {}) {
    this.#assertOpen();
    const selection = anchor === null || anchor === undefined ? null : {
      anchor: this.document.anchorAt(anchor, 'right'), focus: this.document.anchorAt(focus, 'right')
    };
    this.#local = validatePresence({ name, color, selection, state });
    this.#sequence++;
    this.changed();
    return { presence: this.#local, sequence: this.#sequence };
  }

  refresh() {
    this.#assertOpen();
    return { presence: this.#local, sequence: ++this.#sequence };
  }

  receive(clientId, sequence, value) {
    this.#assertOpen();
    validateIdentityPart(clientId, 'Presence client');
    checkLimit(sequence, Number.MAX_SAFE_INTEGER, 'Presence sequence');
    if (clientId === this.identity.clientId) return;
    const previous = this.#remote.get(clientId);
    if (previous && sequence <= previous.sequence) return;
    const presence = validatePresence(value);
    if (presence === null) this.#remote.delete(clientId);
    else {
      checkLimit(this.#remote.size + (previous ? 0 : 1), this.maxPeers, 'Presence peer count');
      this.#remote.set(clientId, { sequence, presence, expiresAt: this.clock.now() + this.ttlMs });
    }
    this.#scheduleExpiry();
    this.changed();
  }

  remove(clientId) {
    if (this.#remote.delete(clientId)) this.changed();
    this.#scheduleExpiry();
  }

  clear() {
    this.#remote.clear();
    this.clock.clearTimeout(this.#expiryTimer);
    this.#expiryTimer = null;
    this.changed();
  }

  changed() {
    if (!this.#disposed) this.#events.emit({ type: 'presence', peers: this.peers, local: this.#local });
  }

  #scheduleExpiry() {
    this.clock.clearTimeout(this.#expiryTimer);
    this.#expiryTimer = null;
    if (!this.#remote.size) return;
    let nearest = Infinity;
    for (const entry of this.#remote.values()) nearest = Math.min(nearest, entry.expiresAt);
    this.#expiryTimer = this.clock.setTimeout(() => {
      const now = this.clock.now();
      for (const [clientId, entry] of this.#remote) if (entry.expiresAt <= now) this.#remote.delete(clientId);
      this.#scheduleExpiry();
      this.changed();
    }, Math.max(0, nearest - this.clock.now()));
  }

  #assertOpen() {
    if (this.#disposed) throw new GitError('Disposed', 'Collaboration presence is disposed');
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clock.clearTimeout(this.#expiryTimer);
    this.#remote.clear();
    this.#events.clear();
  }
}
