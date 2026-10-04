import { GitError, checkLimit } from '../errors.js';
import { CollaborationEvents, collaborationClock } from './events.js';
import { CollaborationPresence } from './presence.js';
import { MemoryCollaborationPersistence } from './persistence.js';
import { validateIdentity, sameDocument, parseAtomId, validateUpdate, COLLAB_PROTOCOL_VERSION } from './validation.js';
import { CollaborationMessage as Message, collaborationMessage } from './protocol.js';

/** One live document. Local edits are immediate; only durably journaled updates enter the network outbox. */
export class CollabSession {
  #events = new CollaborationEvents();
  #pending = new Map();
  #inflight = new Set();
  #persisting = new Map();
  #journal = Promise.resolve();
  #startup = null;
  #subscriptions = [];
  #loaded = false;
  #disposed = false;
  #disposal = null;
  #ready = false;
  #sync = null;
  #syncPromise = null;
  #generation = 0;
  #syncTimer = null;
  #flushTimer = null;
  #presenceTimer = null;
  #permissions = null;
  #initialUpdate = null;
  #initializing = false;
  #storageFailed = false;
  #abort = new AbortController();

  constructor(options) {
    this.document = options.document;
    this.transport = options.transport;
    this.identity = validateIdentity(options.identity ?? this.transport.identity);
    if (!sameDocument(this.identity, this.document) || this.identity.clientId !== this.document.actorId) {
      throw new GitError('Auth', 'Collaboration document and transport identities must agree');
    }
    this.persistence = options.persistence ?? new MemoryCollaborationPersistence({ limits: this.document.limits });
    this.ownPersistence = options.ownPersistence ?? !options.persistence;
    this.ownDocument = options.ownDocument === true;
    this.clock = collaborationClock(options.clock);
    this.maxInFlight = options.maxInFlight ?? 32;
    this.maxPending = options.maxPending ?? 10000;
    this.syncTimeoutMs = options.syncTimeoutMs ?? 30000;
    this.presenceHeartbeatMs = options.presenceHeartbeatMs ?? 15000;
    this.initializeText = options.initializeText;
    if (this.initializeText !== undefined && typeof this.initializeText !== 'string') {
      throw new GitError('Corrupt', 'Initial collaboration text must be a string');
    }
    checkLimit(this.maxInFlight, 1024, 'Collaboration in-flight window');
    checkLimit(this.maxPending, this.document.limits.maxOperations, 'Collaboration pending edits');
    if (!this.maxInFlight || !this.maxPending) throw new GitError('Limit', 'Collaboration queue bounds must be positive');
    checkLimit(this.syncTimeoutMs, 2 ** 31 - 1, 'Collaboration sync timeout');
    checkLimit(this.presenceHeartbeatMs, 2 ** 31 - 1, 'Collaboration presence heartbeat');
    this.presence = new CollaborationPresence({
      document: this.document, identity: this.identity, profile: options.profile, clock: this.clock, ttlMs: options.presenceTtlMs
    });
    this.handlers = new Map([
      [Message.SyncStart, message => this.#syncStart(message)],
      [Message.Initialized, message => this.#initialized(message)],
      [Message.SyncBatch, message => this.#syncBatch(message)],
      [Message.SyncEnd, message => this.#syncEnd(message)],
      [Message.Update, message => this.#remoteUpdate(message.update)],
      [Message.Acknowledge, message => this.#acknowledge(message.id)],
      [Message.Presence, message => this.presence.receive(message.clientId, message.sequence, message.presence)],
      [Message.PeerJoined, () => undefined],
      [Message.PeerLeft, message => this.presence.remove(message.clientId)]
    ]);
  }

  get status() {
    let unsaved = 0;
    for (const entry of this.#pending.values()) if (!entry.durable) unsaved++;
    return Object.freeze({
      state: this.#disposed ? 'disposed' : this.#ready ? 'synchronized' : this.transport.state,
      loaded: this.#loaded, connected: this.transport.connected, synchronized: this.#ready,
      pending: this.#pending.size, unsaved, persistent: this.persistence.capability?.persistent === true,
      storageError: this.#storageFailed
    });
  }

  subscribe(listener) {
    return this.#events.subscribe(listener);
  }

  /** Restore local history and pending operations before connecting. This resolves even when the network is offline. */
  start() {
    this.#assertOpen();
    if (!this.#startup) this.#startup = this.#restore();
    return this.#startup;
  }

  async #restore() {
    const saved = await this.persistence.load(this.identity);
    this.#assertOpen();
    await this.document.mergeSnapshot(saved.snapshot, { signal: this.#abort.signal });
    if (saved.initializationId) {
      this.#initialUpdate = this.document.updatesByActor().find(update => update.id === saved.initializationId);
      if (!this.#initialUpdate) throw new GitError('Corrupt', 'Stored room initialization is missing');
    } else if (this.initializeText && !this.document.stats.operations) {
      this.#initialUpdate = this.document.insert(0, this.initializeText);
    } else if (this.initializeText) {
      throw new GitError('Conflict', 'This stored document was joined from a room; join it explicitly instead of creating another seed');
    }
    const pendingIds = new Set(saved.pendingIds);
    checkLimit(pendingIds.size, this.maxPending, 'Restored collaboration pending edits');
    const storedIds = new Set(saved.snapshot.updates.map(update => update.id));
    for (const update of this.document.updatesByActor()) {
      if (pendingIds.has(update.id)) this.#pending.set(update.id, { update, durable: true });
    }
    this.#subscriptions.push(this.document.subscribe(event => this.#documentChanged(event)));
    this.#subscriptions.push(this.presence.subscribe(event => this.#events.emit(event)));
    this.#subscriptions.push(this.transport.subscribe(event => this.#transportEvent(event)));
    this.#loaded = true;
    for (const update of this.document.updatesByActor()) if (!storedIds.has(update.id)) this.#localUpdate(update);
    await this.whenIdle();
    this.#assertOpen();
    await this.transport.start();
    this.#stateChanged();
    return this;
  }

  /** The model updates synchronously; the promise resolves after durable local commit, before any server acknowledgment. */
  replace(offset, deleteCount, text) {
    this.#assertOpen();
    if (!this.#loaded) throw new GitError('Conflict', 'Collaboration session has not finished restoring');
    if (this.#permissions?.write === false) throw new GitError('Auth', 'This collaboration room is read-only');
    checkLimit(this.#pending.size + 1, this.maxPending, 'Collaboration pending edits');
    const update = this.document.replace(offset, deleteCount, text);
    return update ? this.#persisting.get(update.id) ?? Promise.resolve(update) : Promise.resolve(null);
  }

  setPresence(value) {
    this.#assertOpen();
    const result = this.presence.setLocal(value);
    this.#schedulePresence(50);
    return result;
  }

  #documentChanged(event) {
    if (this.#disposed) return;
    if (event.local && event.update) this.#localUpdate(event.update);
    this.#events.emit({ type: 'document', change: event });
    this.presence.changed();
  }

  #localUpdate(update) {
    if (update.actorId !== this.identity.clientId) throw new GitError('Auth', 'Local update has another actor identity');
    this.#pending.set(update.id, { update, durable: false });
    const task = this.#queueJournal(() => this.persistence.append(this.identity, update, {
      pending: true, initialize: update.id === this.#initialUpdate?.id
    })).then(() => {
      const entry = this.#pending.get(update.id);
      if (entry) entry.durable = true;
      this.#persisting.delete(update.id);
      this.#stateChanged();
      this.#flush();
      return update;
    }, error => {
      this.#persisting.delete(update.id);
      this.#report(error);
      this.#stateChanged();
      throw error;
    });
    this.#persisting.set(update.id, task);
    void task.catch(() => undefined);
    this.#stateChanged();
    return task;
  }

  #transportEvent(event) {
    if (this.#disposed) return;
    if (event.type === 'open') {
      this.#permissions = event.permissions;
      this.#ready = false;
      this.#generation++;
      this.#inflight.clear();
      this.#sync?.abort.abort();
      this.#sync = null;
      this.#initializing = this.#initialUpdate !== null;
      for (const peer of event.peers) if (peer.presence) this.presence.receive(peer.clientId, peer.sequence ?? 0, peer.presence);
      this.clock.clearTimeout(this.#syncTimer);
      if (this.#initialUpdate && this.#pending.get(this.#initialUpdate.id)?.durable === false) {
        this.#report(new GitError('Quota', 'The initial document must be saved locally before creating the room'));
        this.#stateChanged();
        return;
      }
      this.#syncTimer = this.clock.setTimeout(() => {
        this.#report(new GitError('Network', 'Collaboration synchronization timed out'));
        this.transport.reconnect();
      }, this.syncTimeoutMs);
      this.transport.send(this.#initializing
        ? collaborationMessage(Message.Initialize, { update: this.#initialUpdate })
        : collaborationMessage(Message.SyncRequest));
    } else if (event.type === 'close') {
      this.#ready = false;
      this.#generation++;
      this.#inflight.clear();
      this.#sync?.abort.abort();
      this.#sync = null;
      this.clock.clearTimeout(this.#syncTimer);
      this.presence.clear();
    } else if (event.type === 'message') {
      const handler = this.handlers.get(event.message.type);
      if (!handler) throw new GitError('Corrupt', 'Unexpected collaboration session message');
      const result = handler(event.message);
      if (result?.then) void result.catch(error => this.#syncFailed(error));
    } else if (event.type === 'error' || event.type === 'peer-error') this.#report(event.error);
    else this.#events.emit(event);
    this.#stateChanged();
  }

  #syncStart(message) {
    if (this.#initializing) throw new GitError('Corrupt', 'Room initialization has not completed');
    if (this.#sync) throw new GitError('Corrupt', 'Overlapping collaboration snapshots');
    if (typeof message.syncId !== 'string' || message.syncId.length > 128) throw new GitError('Corrupt', 'Invalid collaboration sync identifier');
    checkLimit(message.count, this.document.limits.maxOperations, 'Collaboration snapshot operation count');
    this.#sync = {
      id: message.syncId, expected: message.count, updates: [], ids: new Set(), bytes: 0,
      finishing: false, abort: new AbortController()
    };
  }

  #initialized(message) {
    if (!this.#initializing || message.id !== this.#initialUpdate.id || typeof message.accepted !== 'boolean') {
      throw new GitError('Corrupt', 'Unexpected room initialization reply');
    }
    if (!message.accepted) {
      throw new GitError('Conflict', 'This room already contains another document; your local text and pending edits are preserved');
    }
    this.#initializing = false;
    this.transport.send(collaborationMessage(Message.SyncRequest));
  }

  #syncBatch(message) {
    const sync = this.#requireSync(message.syncId);
    if (sync.finishing) throw new GitError('Corrupt', 'Collaboration snapshot already completed');
    if (!Array.isArray(message.updates)) throw new GitError('Corrupt', 'Invalid collaboration snapshot batch');
    checkLimit(sync.updates.length + message.updates.length, sync.expected, 'Snapshot received operations');
    for (const input of message.updates) {
      const update = validateUpdate(input, this.document.limits);
      if (!sameDocument(this.identity, update) || sync.ids.has(update.id)) throw new GitError('Corrupt', 'Duplicate or foreign snapshot operation');
      sync.bytes += new TextEncoder().encode(JSON.stringify(update)).byteLength;
      checkLimit(sync.bytes, this.document.limits.maxHistoryBytes, 'Snapshot received bytes');
      sync.ids.add(update.id);
      sync.updates.push(update);
    }
  }

  #syncEnd(message) {
    const sync = this.#requireSync(message.syncId);
    if (sync.finishing) throw new GitError('Corrupt', 'Collaboration snapshot already completed');
    if (sync.updates.length !== sync.expected) throw new GitError('Corrupt', 'Incomplete collaboration snapshot');
    sync.finishing = true;
    const generation = this.#generation;
    this.#syncPromise = this.#finishSync(sync, generation);
    return this.#syncPromise;
  }

  async #finishSync(sync, generation) {
    const snapshot = {
      type: 'snapshot', version: COLLAB_PROTOCOL_VERSION, workspaceId: this.identity.workspaceId,
      documentId: this.identity.documentId, updates: sync.updates
    };
    await this.document.mergeSnapshot(snapshot, { signal: sync.abort.signal });
    await this.#persistBatches(sync.updates.map(update => ({ update, pending: false })));
    this.#assertGeneration(generation);
    const missing = [];
    for (const update of this.document.updatesByActor()) {
      if (!sync.ids.has(update.id)) {
        missing.push({ update, pending: true });
        if (!this.#pending.has(update.id)) this.#pending.set(update.id, { update, durable: false });
      } else if (this.#pending.has(update.id)) await this.#acknowledge(update.id);
    }
    await this.#persistBatches(missing);
    this.#assertGeneration(generation);
    for (const entry of missing) {
      const pending = this.#pending.get(entry.update.id);
      if (pending) pending.durable = true;
    }
    this.#sync = null;
    this.#ready = true;
    this.#storageFailed = false;
    this.clock.clearTimeout(this.#syncTimer);
    this.#syncTimer = null;
    this.#stateChanged();
    this.#flush();
    this.#sendPresence();
  }

  async #persistBatches(entries) {
    for (let index = 0; index < entries.length; index += 256) {
      this.#assertOpen();
      const batch = entries.slice(index, index + 256);
      await this.#queueJournal(() => this.persistence.appendMany(this.identity, batch));
    }
  }

  #remoteUpdate(input) {
    if (this.#initializing) return;
    const prepared = this.document.prepareUpdate(input);
    if (prepared.duplicate) return;
    this.document.apply(prepared.update);
    void this.#queueJournal(() => this.persistence.append(this.identity, prepared.update)).catch(error => {
      this.#storageFailed = true;
      this.#report(error);
      this.#stateChanged();
    });
  }

  async #acknowledge(id) {
    if (parseAtomId(id).actor !== this.identity.clientId) throw new GitError('Auth', 'Acknowledgment belongs to another actor');
    this.#inflight.delete(id);
    if (!this.#pending.has(id)) return;
    await this.#queueJournal(() => this.persistence.acknowledge(this.identity, id));
    this.#pending.delete(id);
    this.#stateChanged();
    this.#flush();
  }

  #flush() {
    if (this.#disposed || !this.#ready || !this.transport.connected || this.#permissions?.write !== true) return;
    for (const [id, entry] of this.#pending) {
      if (this.#inflight.size >= this.maxInFlight) break;
      if (!entry.durable || this.#inflight.has(id)) continue;
      this.#inflight.add(id);
      try {
        this.transport.send(collaborationMessage(Message.Update, { update: entry.update }));
      } catch (error) {
        this.#inflight.delete(id);
        this.#report(error);
        this.clock.clearTimeout(this.#flushTimer);
        this.#flushTimer = this.clock.setTimeout(() => this.#flush(), 100);
        break;
      }
    }
  }

  #schedulePresence(delay = this.presenceHeartbeatMs) {
    this.clock.clearTimeout(this.#presenceTimer);
    if (!this.#disposed && delay > 0) this.#presenceTimer = this.clock.setTimeout(() => this.#sendPresence(), delay);
  }

  #sendPresence() {
    if (this.#disposed || !this.#ready || !this.transport.connected) return;
    try {
      this.transport.send(collaborationMessage(Message.Presence, this.presence.refresh()));
      this.#schedulePresence();
    } catch (error) {
      this.#report(error);
    }
  }

  async retryPendingPersistence() {
    this.#assertOpen();
    const tasks = [];
    for (const entry of this.#pending.values()) {
      if (!entry.durable && !this.#persisting.has(entry.update.id)) tasks.push(this.#localUpdate(entry.update));
    }
    await Promise.all(tasks);
    if (!this.#ready || this.#storageFailed) this.transport.reconnect();
  }

  async whenIdle() {
    let journal;
    do {
      journal = this.#journal;
      await journal;
    } while (journal !== this.#journal);
  }

  #queueJournal(action) {
    const task = this.#journal.then(action);
    this.#journal = task.catch(() => undefined);
    return task;
  }

  #requireSync(id) {
    if (!this.#sync || this.#sync.id !== id) throw new GitError('Corrupt', 'Snapshot batch belongs to another sync');
    return this.#sync;
  }

  #assertGeneration(generation) {
    if (this.#disposed || generation !== this.#generation) throw new GitError('Cancelled', 'Collaboration sync superseded');
  }

  #syncFailed(error) {
    if (error?.code === 'Cancelled' || this.#disposed) return;
    if (['Quota', 'Network'].includes(error?.code)) this.#storageFailed = true;
    this.#sync?.abort.abort();
    this.#sync = null;
    this.#ready = false;
    this.clock.clearTimeout(this.#syncTimer);
    this.#syncTimer = null;
    this.#report(error);
    this.#stateChanged();
  }

  #report(error) {
    if (!this.#disposed) this.#events.emit({ type: 'error', error: GitError.from(error) });
  }

  #stateChanged() {
    if (!this.#disposed) this.#events.emit({ type: 'state', status: this.status });
  }

  #assertOpen() {
    if (this.#disposed) throw new GitError('Disposed', 'Collaboration session is disposed');
  }

  dispose() {
    if (this.#disposal) return this.#disposal;
    this.#disposed = true;
    this.#abort.abort();
    this.#sync?.abort.abort();
    for (const unsubscribe of this.#subscriptions) unsubscribe();
    for (const timer of [this.#syncTimer, this.#flushTimer, this.#presenceTimer]) this.clock.clearTimeout(timer);
    this.transport.dispose();
    this.presence.dispose();
    this.#disposal = this.#finishDisposal();
    return this.#disposal;
  }

  async #finishDisposal() {
    await this.whenIdle();
    if (this.ownPersistence) this.persistence.dispose();
    if (this.ownDocument) this.document.dispose();
    this.#events.clear();
  }
}
