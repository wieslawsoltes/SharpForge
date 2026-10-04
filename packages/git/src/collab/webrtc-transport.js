import { GitError, checkLimit } from '../errors.js';
import { CollaborationEvents } from './events.js';
import { CollaborationPeer } from './webrtc-peer.js';
import { collaborationLimits, validateIdentityPart, validateUpdate, sameDocument } from './validation.js';
import {
  CollaborationMessage as Message, collaborationMessage, serializeCollaborationMessage,
  parseCollaborationMessage, publicCollaborationFailure
} from './protocol.js';

/** Direct WebRTC update delivery plus authenticated WebSocket persistence, acknowledgments and recovery. */
export class WebRtcCollabTransport {
  #events = new CollaborationEvents();
  #peers = new Map();
  #permissions = new Map();
  #subscription = null;
  #disposed = false;
  #peerSequence = 0;
  #startup = null;
  #metrics = { directSent: 0, directReceived: 0, fallbackSent: 0 };

  constructor({ signaling, RTCPeerConnection, rtcConfiguration = {}, assertIceServer, autoConnect = true, maxPeers = 32, limits } = {}) {
    if (!signaling?.identity || typeof signaling.send !== 'function') throw new TypeError('WebRTC requires an authenticated signaling transport');
    this.signaling = signaling;
    this.identity = signaling.identity;
    this.PeerConnection = RTCPeerConnection ?? globalThis.RTCPeerConnection;
    this.configuration = rtcConfiguration;
    this.assertIceServer = assertIceServer;
    this.autoConnect = autoConnect;
    this.maxPeers = maxPeers;
    checkLimit(maxPeers, 1024, 'WebRTC peer count');
    this.limits = collaborationLimits(limits);
  }

  get state() {
    return this.signaling.state;
  }

  get connected() {
    return this.signaling.connected;
  }

  get metrics() {
    return Object.freeze({ ...this.#metrics, connectedPeers: [...this.#peers.values()].filter(peer => peer.ready).length });
  }

  get diagnostics() {
    return Object.freeze({ state: this.state, connected: this.connected,
      peers: Object.freeze([...this.#peers.values()].map(peer => peer.diagnostics)) });
  }

  subscribe(listener) {
    return this.#events.subscribe(listener);
  }

  start() {
    if (this.#disposed) throw new GitError('Disposed', 'WebRTC collaboration transport is disposed');
    this.#startup ??= this.#start();
    return this.#startup;
  }

  async #start() {
    if (typeof this.PeerConnection !== 'function') throw new GitError('Unsupported', 'RTCPeerConnection is unavailable');
    for (const server of this.configuration.iceServers ?? []) {
      const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
      if (!Array.isArray(urls) || typeof this.assertIceServer !== 'function') {
        throw new GitError('Unsafe', 'Each STUN/TURN server requires an explicit grant callback');
      }
      for (const url of urls) {
        if (typeof url !== 'string' || !/^(stun|stuns|turn|turns):/i.test(url)) throw new GitError('Unsafe', 'Invalid STUN/TURN server');
        await this.assertIceServer(url);
      }
    }
    if (this.#disposed) throw new GitError('Disposed', 'WebRTC collaboration transport is disposed');
    this.#subscription = this.signaling.subscribe(event => this.#signalingEvent(event));
    this.signaling.start();
  }

  reconnect() {
    this.signaling.reconnect();
  }

  connectPeer(clientId) {
    validateIdentityPart(clientId, 'Collaboration peer');
    if (!this.connected || !this.#permissions.has(clientId)) throw new GitError('Auth', 'Peer has not joined this authenticated room');
    if (clientId === this.identity.clientId) throw new GitError('Conflict', 'Cannot connect a collaboration client to itself');
    this.#peer(clientId).initiate();
  }

  send(message) {
    // The durable authority owns acknowledgments, including when direct delivery wins the latency race.
    const result = this.signaling.send(message);
    if (message.type !== Message.Update) return result;
    const text = serializeCollaborationMessage(message, this.limits.maxUpdateBytes + 4096);
    let direct = 0;
    for (const peer of this.#peers.values()) if (peer.send(text)) direct++;
    this.#metrics.directSent += direct;
    if (!direct) this.#metrics.fallbackSent++;
    return result;
  }

  #signalingEvent(event) {
    if (this.#disposed) return;
    if (event.type === 'open') {
      for (const peer of event.peers) this.#permissions.set(peer.clientId, peer.permissions ?? { read: true, write: false });
      this.#events.emit(event);
      if (this.autoConnect) {
        for (const peer of event.peers) {
          if (this.#peers.size >= this.maxPeers) break;
          this.connectPeer(peer.clientId);
        }
      }
      return;
    }
    if (event.type === 'close') this.#clearPeers();
    if (event.type !== 'message') {
      this.#events.emit(event);
      return;
    }
    const message = event.message;
    if (message.type === Message.Signal) {
      this.#signal(message);
      return;
    }
    if (message.type === Message.PeerJoined) {
      validateIdentityPart(message.clientId, 'Joined peer');
      this.#permissions.set(message.clientId, message.permissions ?? { read: true, write: false });
      if (this.autoConnect && this.#peers.size < this.maxPeers) this.connectPeer(message.clientId);
    } else if (message.type === Message.PeerLeft) {
      this.#peers.get(message.clientId)?.dispose();
      this.#peers.delete(message.clientId);
      this.#permissions.delete(message.clientId);
    }
    this.#events.emit(event);
  }

  #signal(message) {
    const source = validateIdentityPart(message.sourceClientId, 'Signaling source');
    if (message.targetClientId !== this.identity.clientId || !this.#permissions.has(source)) {
      throw new GitError('Auth', 'Signaling source is outside the authenticated room');
    }
    if (!this.#peers.has(source) && this.#peers.size >= this.maxPeers) return;
    this.#peer(source).signal(message.signal);
  }

  #peer(clientId) {
    let peer = this.#peers.get(clientId);
    if (peer) return peer;
    checkLimit(this.#peers.size + 1, this.maxPeers, 'WebRTC peer count');
    peer = new CollaborationPeer({
      identity: this.identity, remoteId: clientId, PeerConnection: this.PeerConnection, configuration: this.configuration,
      maximumBytes: this.limits.maxUpdateBytes + 4096, sessionId: 'rtc-' + ++this.#peerSequence,
      sendSignal: signal => this.signaling.send(collaborationMessage(Message.Signal, { targetClientId: clientId, signal })),
      onData: bytes => this.#directUpdate(clientId, bytes),
      onState: event => {
        if (event.type === 'peer-close' && this.#peers.get(clientId) === peer) this.#peers.delete(clientId);
        this.#events.emit(event);
      },
      onError: error => {
        const failure = publicCollaborationFailure(error);
        this.#events.emit({ type: 'peer-error', clientId, error: new GitError(failure.code, failure.message) });
      }
    });
    this.#peers.set(clientId, peer);
    return peer;
  }

  #directUpdate(clientId, bytes) {
    const message = parseCollaborationMessage(bytes, this.limits.maxUpdateBytes + 4096);
    if (message.type !== Message.Update || this.#permissions.get(clientId)?.write !== true) {
      throw new GitError('Auth', 'WebRTC peer is not permitted to publish updates');
    }
    const update = validateUpdate(message.update, this.limits);
    if (update.actorId !== clientId || !sameDocument(update, this.identity)) {
      throw new GitError('Auth', 'WebRTC update actor or document does not match the authenticated peer');
    }
    this.#metrics.directReceived++;
    this.#events.emit({ type: 'message', message: collaborationMessage(Message.Update, { update }), backend: 'webrtc' });
  }

  #clearPeers() {
    for (const peer of this.#peers.values()) peer.dispose();
    this.#peers.clear();
    this.#permissions.clear();
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#subscription?.();
    this.#subscription = null;
    this.#clearPeers();
    this.signaling.dispose();
    this.#events.clear();
  }
}
