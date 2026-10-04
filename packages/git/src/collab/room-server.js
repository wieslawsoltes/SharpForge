import { GitError, checkLimit } from '../errors.js';
import { SequenceCrdt } from './crdt.js';
import { collaborationClock } from './events.js';
import { collaborationLimits, validateIdentity, sameIdentity, roomKey, validateIdentityPart } from './validation.js';
import {
  CollaborationMessage as Message, parseCollaborationMessage, collaborationMessage,
  serializeCollaborationMessage, validatePresence, validateSignal, publicCollaborationFailure
} from './protocol.js';

/** Authenticated room authority. Persistence must append idempotently before this server acknowledges edits. */
export class CollabRoomServer {
  #rooms = new Map();
  #connections = new Set();
  #disposed = false;
  #serial = 0;

  constructor({ authorize, persistence = null, limits, clock, maxClients = 64, maxRooms = 1024,
    maxConnections = 1024, authTimeoutMs = 10000 } = {}) {
    if (typeof authorize !== 'function') throw new TypeError('Collaboration server requires an authorization callback');
    this.authorize = authorize;
    this.persistence = persistence;
    this.limits = collaborationLimits(limits);
    this.clock = collaborationClock(clock);
    this.maxClients = maxClients;
    this.maxRooms = maxRooms;
    this.maxConnections = maxConnections;
    this.authTimeoutMs = authTimeoutMs;
    for (const bound of [maxClients, maxRooms, maxConnections]) {
      checkLimit(bound, 65536, 'Collaboration server capacity');
      if (!bound) throw new GitError('Limit', 'Collaboration server capacity must be positive');
    }
    checkLimit(authTimeoutMs, 2 ** 31 - 1, 'Collaboration authentication timeout');
    this.handlers = new Map([
      [Message.SyncRequest, (connection, message) => this.#sync(connection, message)],
      [Message.Update, (connection, message) => this.#update(connection, message)],
      [Message.Initialize, (connection, message) => this.#initialize(connection, message)],
      [Message.Presence, (connection, message) => this.#presence(connection, message)],
      [Message.Signal, (connection, message) => this.#signal(connection, message)],
      [Message.Ping, (connection, message) => this.#send(connection, Message.Pong, {
        nonce: validateIdentityPart(message.nonce, 'Heartbeat nonce')
      })]
    ]);
  }

  /** Socket adapter supplies send(text), close(code,reason), and optional audit metadata without secrets. */
  attach(socket) {
    if (this.#disposed) throw new GitError('Disposed', 'Collaboration server is disposed');
    if (typeof socket?.send !== 'function' || typeof socket?.close !== 'function') throw new TypeError('Invalid server socket adapter');
    checkLimit(this.#connections.size + 1, this.maxConnections, 'Collaboration connection count');
    const connection = {
      socket, identity: null, permissions: null, room: null, closed: false, inbound: Promise.resolve(),
      outbound: Promise.resolve(), queuedBytes: 0, inboundCount: 0, presenceSequence: -1, presence: null,
      abort: new AbortController(), authTimer: null, expiryTimer: null
    };
    this.#connections.add(connection);
    connection.authTimer = this.clock.setTimeout(() => this.#drop(connection, 1008, 'Authentication timeout'), this.authTimeoutMs);
    return Object.freeze({
      receive: data => {
        if (connection.closed) return Promise.resolve();
        const length = typeof data === 'string' ? data.length : data?.byteLength;
        if (!Number.isSafeInteger(length) || length > this.limits.maxUpdateBytes + 4096) {
          return this.#reject(connection, new GitError('Limit', 'Collaboration inbound message exceeds its limit'));
        }
        if (++connection.inboundCount > 64) {
          this.#drop(connection, 1009, 'Inbound message queue exceeded');
          return Promise.resolve();
        }
        connection.inbound = connection.inbound.then(() => this.#receive(connection, data))
          .catch(error => this.#reject(connection, error)).finally(() => { connection.inboundCount--; });
        return connection.inbound;
      },
      close: () => this.#drop(connection, 1000, 'Peer closed')
    });
  }

  async #receive(connection, data) {
    if (connection.closed) return;
    const message = parseCollaborationMessage(data, this.limits.maxUpdateBytes + 4096);
    if (!connection.identity) {
      if (message.type !== Message.Authenticate) throw new GitError('Auth', 'Authentication required');
      await this.#authenticate(connection, message);
      return;
    }
    const handler = this.handlers.get(message.type);
    if (!handler) throw new GitError('Corrupt', 'Message not valid in authenticated state');
    await handler(connection, message);
  }

  async #authenticate(connection, message) {
    const identity = validateIdentity(message.identity);
    if (typeof message.token !== 'string' || !message.token || message.token.length > 8192) {
      throw new GitError('Auth', 'Invalid room token');
    }
    let authorization;
    try {
      authorization = await this.authorize({ token: message.token, identity, signal: connection.abort.signal, context: connection.socket.context });
    } catch {
      throw new GitError('Auth', 'Room token rejected');
    }
    if (connection.closed) return;
    if (!authorization?.identity || !sameIdentity(validateIdentity(authorization.identity), identity) || authorization.permissions?.read !== true) {
      throw new GitError('Auth', 'Room authorization identity does not match');
    }
    if (authorization.expiresAt !== undefined) {
      const remaining = authorization.expiresAt - this.clock.now();
      if (!Number.isFinite(remaining) || remaining <= 0) throw new GitError('Auth', 'Room token expired');
      const expire = () => {
        const delay = authorization.expiresAt - this.clock.now();
        if (delay <= 0) this.#drop(connection, 1008, 'Authorization expired');
        else connection.expiryTimer = this.clock.setTimeout(expire, Math.min(delay, 2 ** 31 - 1));
      };
      expire();
    }
    const room = await this.#room(identity);
    if (connection.closed) return;
    if (room.clients.has(identity.clientId)) throw new GitError('Conflict', 'Client identity is already connected');
    checkLimit(room.clients.size + 1, this.maxClients, 'Collaboration clients per room');
    this.clock.clearTimeout(connection.authTimer);
    connection.identity = identity;
    connection.permissions = { read: true, write: authorization.permissions.write === true };
    connection.room = room;
    const peers = [...room.clients.values()].map(peer => ({
      clientId: peer.identity.clientId, presence: peer.presence, sequence: peer.presenceSequence, permissions: peer.permissions
    }));
    room.clients.set(identity.clientId, connection);
    await this.#send(connection, Message.Ready, { identity, permissions: connection.permissions, peers });
    if (connection.closed) return;
    this.#broadcast(room, connection, Message.PeerJoined, { clientId: identity.clientId, permissions: connection.permissions });
  }

  async #room(identity) {
    const key = roomKey(identity);
    let promise = this.#rooms.get(key);
    if (!promise) {
      checkLimit(this.#rooms.size + 1, this.maxRooms, 'Collaboration room count');
      promise = this.#loadRoom(identity);
      this.#rooms.set(key, promise);
      try {
        await promise;
      } catch (error) {
        if (this.#rooms.get(key) === promise) this.#rooms.delete(key);
        throw error;
      }
    }
    return promise;
  }

  async #loadRoom(identity) {
    const snapshot = await this.persistence?.load(identity);
    const options = { ...identity, actorId: 'server', limits: this.limits };
    const document = snapshot ? SequenceCrdt.fromSnapshot(snapshot, options) : new SequenceCrdt(options);
    return { document, clients: new Map(), transaction: Promise.resolve() };
  }

  #withRoom(connection, action) {
    const room = connection.room;
    const transaction = room.transaction.then(() => {
      if (connection.closed) throw new GitError('Disposed', 'Connection closed');
      return action(room);
    });
    room.transaction = transaction.catch(() => undefined);
    return transaction;
  }

  async #sync(connection) {
    const snapshot = await this.#withRoom(connection, room => room.document.snapshot());
    const syncId = 'sync-' + ++this.#serial;
    await this.#send(connection, Message.SyncStart, { syncId, count: snapshot.updates.length });
    let batch = [];
    let bytes = 0;
    for (const update of snapshot.updates) {
      if (connection.closed) return;
      const size = JSON.stringify(update).length * 3;
      if (batch.length && bytes + size > this.limits.maxUpdateBytes / 2) {
        await this.#send(connection, Message.SyncBatch, { syncId, updates: batch });
        batch = [];
        bytes = 0;
      }
      batch.push(update);
      bytes += size;
    }
    if (batch.length) await this.#send(connection, Message.SyncBatch, { syncId, updates: batch });
    await this.#send(connection, Message.SyncEnd, { syncId });
  }

  #update(connection, message) {
    if (!connection.permissions.write) throw new GitError('Auth', 'Room is read-only');
    if (message.update?.actorId !== connection.identity.clientId) throw new GitError('Auth', 'Only the authenticated actor can publish its updates');
    return this.#withRoom(connection, async room => {
      const prepared = room.document.prepareUpdate(message.update);
      if (!prepared.duplicate) {
        await this.persistence?.append(connection.identity, prepared.update);
        if (this.#disposed) throw new GitError('Disposed', 'Server disposed while persisting an operation');
        room.document.apply(prepared.update);
        this.#broadcast(room, connection, Message.Update, { update: prepared.update });
      }
      await this.#send(connection, Message.Acknowledge, { id: prepared.update.id });
    });
  }

  #initialize(connection, message) {
    if (!connection.permissions.write || message.update?.actorId !== connection.identity.clientId) {
      throw new GitError('Auth', 'Only a writable authenticated actor can initialize a room');
    }
    return this.#withRoom(connection, async room => {
      const prepared = room.document.prepareUpdate(message.update);
      const update = prepared.update;
      if (!update.inserts.length || update.inserts[0].parent !== null || update.deletes.length) {
        throw new GitError('Corrupt', 'Room initialization must be a complete initial text insertion');
      }
      const accepted = prepared.duplicate || room.document.stats.operations === 0;
      if (accepted && !prepared.duplicate) {
        await this.persistence?.append(connection.identity, update);
        if (this.#disposed) throw new GitError('Disposed', 'Server disposed while initializing a room');
        room.document.apply(update);
        this.#broadcast(room, connection, Message.Update, { update });
      }
      await this.#send(connection, Message.Initialized, { id: update.id, accepted });
    });
  }

  #presence(connection, message) {
    checkLimit(message.sequence, Number.MAX_SAFE_INTEGER, 'Presence sequence');
    if (message.sequence <= connection.presenceSequence) return;
    connection.presenceSequence = message.sequence;
    connection.presence = validatePresence(message.presence);
    this.#broadcast(connection.room, connection, Message.Presence, {
      clientId: connection.identity.clientId, sequence: message.sequence, presence: connection.presence
    });
  }

  #signal(connection, message) {
    const target = validateIdentityPart(message.targetClientId, 'WebRTC target');
    const peer = connection.room.clients.get(target);
    if (peer === connection) throw new GitError('Corrupt', 'A client cannot signal itself');
    // Membership can change after Ready/PeerJoined. The same reply covers absent and foreign-room IDs without disclosure.
    if (!peer) return this.#send(connection, Message.PeerLeft, { clientId: target });
    return this.#send(peer, Message.Signal, {
      sourceClientId: connection.identity.clientId, targetClientId: target, signal: validateSignal(message.signal)
    });
  }

  #broadcast(room, except, type, fields) {
    for (const connection of room.clients.values()) {
      if (connection !== except && !connection.closed) void this.#send(connection, type, fields);
    }
  }

  #send(connection, type, fields) {
    if (connection.closed) return Promise.resolve(false);
    const text = serializeCollaborationMessage(collaborationMessage(type, fields), this.limits.maxUpdateBytes + 4096);
    const bytes = new TextEncoder().encode(text).byteLength;
    if (connection.queuedBytes + bytes > this.limits.maxUpdateBytes * 4) {
      this.#drop(connection, 1009, 'Slow peer exceeded outbound queue');
      return Promise.resolve(false);
    }
    connection.queuedBytes += bytes;
    const send = connection.outbound.then(async () => {
      if (!connection.closed) await connection.socket.send(text);
      return !connection.closed;
    });
    connection.outbound = send.catch(() => this.#drop(connection, 1011, 'Transport send failed')).finally(() => {
      connection.queuedBytes -= bytes;
    });
    return connection.outbound;
  }

  async #reject(connection, error) {
    if (connection.closed) return;
    const failure = publicCollaborationFailure(error);
    await this.#send(connection, Message.Error, { error: failure });
    this.#drop(connection, failure.code === 'Auth' ? 1008 : 1003, failure.message);
  }

  #drop(connection, code, reason) {
    if (connection.closed) return;
    connection.closed = true;
    connection.abort.abort();
    this.clock.clearTimeout(connection.authTimer);
    this.clock.clearTimeout(connection.expiryTimer);
    this.#connections.delete(connection);
    const room = connection.room;
    if (room?.clients.get(connection.identity.clientId) === connection) {
      room.clients.delete(connection.identity.clientId);
      this.#broadcast(room, connection, Message.PeerLeft, { clientId: connection.identity.clientId });
    }
    connection.socket.close(code, reason);
  }

  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const connection of [...this.#connections]) this.#drop(connection, 1001, 'Server stopped');
    for (const promise of this.#rooms.values()) {
      const room = await promise;
      await room.transaction;
      room.document.dispose();
    }
    this.#rooms.clear();
  }
}
