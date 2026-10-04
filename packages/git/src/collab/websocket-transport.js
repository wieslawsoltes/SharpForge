import { GitError, checkLimit } from '../errors.js';
import { CollaborationEvents, collaborationClock } from './events.js';
import { collaborationLimits, validateIdentity, sameIdentity, validateIdentityPart } from './validation.js';
import {
  CollaborationMessage as Message, collaborationMessage, parseCollaborationMessage,
  serializeCollaborationMessage, publicCollaborationFailure
} from './protocol.js';

/** WebSocket room transport. Authentication stays in the first frame, never URLs or persisted state. */
export class WebSocketCollabTransport {
  #events = new CollaborationEvents();
  #socket = null;
  #attempt = null;
  #generation = 0;
  #retry = 0;
  #retryTimer = null;
  #authTimer = null;
  #heartbeatTimer = null;
  #pongTimer = null;
  #ping = 0;
  #awaitingPong = null;
  #started = false;
  #disposed = false;
  #state = 'idle';

  constructor(options = {}) {
    this.identity = validateIdentity(options.identity);
    this.url = validateSocketUrl(options.url, options.allowInsecureLoopback === true);
    if (typeof options.tokenProvider !== 'function' || typeof options.assertOrigin !== 'function') {
      throw new GitError('Auth', 'Collaboration requires explicit token and origin-grant providers');
    }
    this.tokenProvider = options.tokenProvider;
    this.assertOrigin = options.assertOrigin;
    this.Socket = options.WebSocket ?? globalThis.WebSocket;
    this.limits = collaborationLimits(options.limits);
    this.clock = collaborationClock(options.clock);
    this.retryMinimumMs = options.retryMinimumMs ?? 250;
    this.retryMaximumMs = options.retryMaximumMs ?? 30000;
    this.authTimeoutMs = options.authTimeoutMs ?? 10000;
    this.heartbeatMs = options.heartbeatMs ?? 15000;
    this.pongTimeoutMs = options.pongTimeoutMs ?? 10000;
    this.random = options.random ?? Math.random;
    this.maxBufferedBytes = options.maxBufferedBytes ?? this.limits.maxUpdateBytes * 4;
    for (const duration of [this.retryMinimumMs, this.retryMaximumMs, this.authTimeoutMs, this.heartbeatMs, this.pongTimeoutMs]) {
      checkLimit(duration, 2 ** 31 - 1, 'Collaboration timer');
    }
    if (!this.retryMinimumMs || this.retryMaximumMs < this.retryMinimumMs || !this.authTimeoutMs || !this.pongTimeoutMs) {
      throw new GitError('Limit', 'Collaboration retry and timeout bounds are invalid');
    }
    checkLimit(this.maxBufferedBytes, this.limits.maxHistoryBytes, 'Collaboration outbound buffer');
  }

  get state() {
    return this.#state;
  }

  get connected() {
    return this.#state === 'open';
  }

  subscribe(listener) {
    return this.#events.subscribe(listener);
  }

  /** Start connection attempts without blocking offline document use. */
  start() {
    if (this.#disposed) throw new GitError('Disposed', 'Collaboration transport is disposed');
    if (this.#started) return;
    this.#started = true;
    this.#launch();
  }

  /** Explicit retry after the host has replaced a rejected token or changed an origin grant. */
  reconnect() {
    if (this.#disposed) throw new GitError('Disposed', 'Collaboration transport is disposed');
    this.#started = true;
    this.#cleanup();
    this.#retry = 0;
    this.#events.emit({ type: 'close', retrying: true });
    this.#launch();
  }

  send(message) {
    if (!this.connected || !this.#socket) throw new GitError('Network', 'Collaboration transport is offline');
    const text = serializeCollaborationMessage(message, this.limits.maxUpdateBytes + 4096);
    const bytes = new TextEncoder().encode(text).byteLength;
    checkLimit((this.#socket.bufferedAmount ?? 0) + bytes, this.maxBufferedBytes, 'Collaboration outbound buffer');
    this.#socket.send(text);
    return true;
  }

  #launch() {
    const generation = ++this.#generation;
    this.#connect(generation).catch(error => {
      if (generation === this.#generation && !this.#disposed) this.#failed(error);
    });
  }

  async #connect(generation) {
    this.#setState(this.#retry ? 'reconnecting' : 'connecting');
    if (typeof this.Socket !== 'function') throw new GitError('Unsupported', 'WebSocket is unavailable');
    await this.assertOrigin(this.url);
    if (generation !== this.#generation || this.#disposed) return;
    this.#attempt = new AbortController();
    this.#authTimer = this.clock.setTimeout(() => {
      if (generation === this.#generation) this.#failed(new GitError('Network', 'Collaboration authentication timed out'));
    }, this.authTimeoutMs);
    let token = await this.tokenProvider({ identity: this.identity, signal: this.#attempt.signal });
    if (generation !== this.#generation || this.#disposed) return;
    if (typeof token !== 'string' || !token || token.length > 8192) throw new GitError('Auth', 'Invalid collaboration token');
    const socket = new this.Socket(this.url);
    socket.binaryType = 'arraybuffer';
    this.#socket = socket;
    socket.onopen = () => {
      if (generation !== this.#generation) return;
      this.#setState('authenticating');
      socket.send(serializeCollaborationMessage(collaborationMessage(Message.Authenticate, { identity: this.identity, token })));
      token = null;
      socket.onopen = null;
    };
    socket.onmessage = event => {
      if (generation !== this.#generation) return;
      try {
        this.#received(event.data);
      } catch (error) {
        this.#failed(error);
      }
    };
    socket.onerror = () => {
      if (generation === this.#generation) this.#failed(new GitError('Network', 'Collaboration socket failed'));
    };
    socket.onclose = event => {
      if (generation !== this.#generation) return;
      const code = event.code === 1008 ? 'Auth' : 'Network';
      this.#failed(new GitError(code, 'Collaboration connection closed'));
    };
  }

  #received(input) {
    const message = parseCollaborationMessage(input, this.limits.maxUpdateBytes + 4096);
    if (message.type === Message.Error) {
      const failure = publicCollaborationFailure(message.error);
      throw new GitError(failure.code, failure.message);
    }
    if (this.#state === 'authenticating') {
      if (message.type !== Message.Ready || !sameIdentity(validateIdentity(message.identity), this.identity)) {
        throw new GitError('Auth', 'Unexpected collaboration authentication reply');
      }
      if (message.permissions?.read !== true || !Array.isArray(message.peers) || message.peers.length > 1024) {
        throw new GitError('Corrupt', 'Malformed collaboration ready reply');
      }
      for (const peer of message.peers) validateIdentityPart(peer.clientId, 'Collaboration peer');
      this.clock.clearTimeout(this.#authTimer);
      this.#authTimer = null;
      this.#retry = 0;
      this.#setState('open');
      this.#events.emit({ type: 'open', identity: this.identity, permissions: message.permissions, peers: message.peers });
      this.#scheduleHeartbeat();
      return;
    }
    if (!this.connected) throw new GitError('Auth', 'Collaboration message arrived before authentication');
    if (message.type === Message.Pong) {
      if (message.nonce !== this.#awaitingPong) throw new GitError('Corrupt', 'Unexpected heartbeat reply');
      this.clock.clearTimeout(this.#pongTimer);
      this.#pongTimer = null;
      this.#awaitingPong = null;
      this.#scheduleHeartbeat();
    } else this.#events.emit({ type: 'message', message });
  }

  #scheduleHeartbeat() {
    if (!this.heartbeatMs || !this.connected) return;
    this.#heartbeatTimer = this.clock.setTimeout(() => {
      this.#awaitingPong = 'ping-' + ++this.#ping;
      try {
        this.#pongTimer = this.clock.setTimeout(() => {
          this.#failed(new GitError('Network', 'Collaboration heartbeat timed out'));
        }, this.pongTimeoutMs);
        this.send(collaborationMessage(Message.Ping, { nonce: this.#awaitingPong }));
      } catch (error) {
        this.#failed(error);
      }
    }, this.heartbeatMs);
  }

  #failed(error) {
    if (this.#disposed) return;
    const failure = publicCollaborationFailure(error);
    const fatal = ['Auth', 'Unsafe', 'Conflict', 'Corrupt', 'Unsupported'].includes(error?.code);
    this.#cleanup();
    this.#setState(fatal ? 'blocked' : 'reconnecting');
    this.#events.emit({ type: 'error', error: new GitError(failure.code, failure.message), retrying: !fatal });
    this.#events.emit({ type: 'close', retrying: !fatal });
    if (!fatal && this.#started) {
      const base = Math.min(this.retryMaximumMs, this.retryMinimumMs * 2 ** Math.min(this.#retry++, 20));
      const sample = this.random();
      const jitter = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
      const delay = Math.min(this.retryMaximumMs, Math.round(base * (0.8 + jitter * 0.4)));
      this.#retryTimer = this.clock.setTimeout(() => this.#launch(), delay);
    }
  }

  #cleanup() {
    this.#generation++;
    this.#attempt?.abort();
    this.#attempt = null;
    for (const timer of [this.#authTimer, this.#retryTimer, this.#heartbeatTimer, this.#pongTimer]) this.clock.clearTimeout(timer);
    this.#authTimer = this.#retryTimer = this.#heartbeatTimer = this.#pongTimer = null;
    this.#awaitingPong = null;
    if (this.#socket) {
      const socket = this.#socket;
      this.#socket = null;
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close(1000, 'Session reset');
    }
  }

  #setState(state) {
    if (state === this.#state) return;
    this.#state = state;
    this.#events.emit({ type: 'state', state });
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#started = false;
    this.#cleanup();
    this.#setState('disposed');
    this.#events.clear();
  }
}

function validateSocketUrl(value, allowLoopback) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new GitError('Unsafe', 'Invalid collaboration endpoint URL');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'wss:' && !(allowLoopback && loopback && url.protocol === 'ws:')) {
    throw new GitError('Unsafe', 'Collaboration requires WSS, or explicitly enabled loopback WS');
  }
  if (url.username || url.password || url.search || url.hash) throw new GitError('Unsafe', 'Collaboration URLs cannot contain credentials or queries');
  return url.href;
}
