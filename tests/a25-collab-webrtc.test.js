import test from 'node:test';
import assert from 'node:assert/strict';
import { CollabRoomServer } from '../packages/git/src/collab/room-server.js';
import { WebSocketCollabTransport } from '../packages/git/src/collab/websocket-transport.js';
import { WebRtcCollabTransport } from '../packages/git/src/collab/webrtc-transport.js';
import { CollaborationPeer } from '../packages/git/src/collab/webrtc-peer.js';
import { CollabSession } from '../packages/git/src/collab/session.js';
import { PeerFrameCodec } from '../packages/git/src/collab/data-framing.js';
import { collaborationMessage } from '../packages/git/src/collab/protocol.js';
import { identity, document, authorize, tokenFor, socketConstructor, waitFor, settle } from './helpers/a25-collab.js';

test('deterministic offer ownership opens one peer, delivers idempotently through both paths and falls back after peer failure', async context => {
  const server = new CollabRoomServer({ authorize });
  const Socket = socketConstructor(server);
  const PeerConnection = peerConnectionFixture();
  const first = createSession('alpha', Socket, PeerConnection);
  const second = createSession('beta', Socket, PeerConnection);
  context.after(async () => { await first.dispose(); await second.dispose(); await server.dispose(); });
  await Promise.all([first.start(), second.start()]);
  await waitFor(() => first.transport.metrics.connectedPeers === 1 && second.transport.metrics.connectedPeers === 1);
  assert.equal(PeerConnection.instances.filter(connection => connection.offered).length, 1);
  await first.replace(0, 0, 'one');
  await waitFor(() => second.document.text === 'one' && !first.status.pending);
  assert.equal(second.document.stats.operations, 1);
  assert(first.transport.metrics.directSent > 0);
  assert(second.transport.metrics.directReceived > 0);
  for (const connection of [...PeerConnection.instances]) connection.close();
  await settle();
  await first.replace(3, 0, ' two');
  await waitFor(() => second.document.text === 'one two' && !first.status.pending);
  assert(first.transport.metrics.fallbackSent > 0);
  first.transport.connectPeer('beta');
  await waitFor(() => first.transport.metrics.connectedPeers === 1 && second.transport.metrics.connectedPeers === 1);
  assert.equal(PeerConnection.instances.length, 4);
});

test('direct data cannot impersonate another actor or introduce another workspace', async context => {
  const server = new CollabRoomServer({ authorize });
  const Socket = socketConstructor(server);
  const PeerConnection = peerConnectionFixture();
  const first = createSession('alpha', Socket, PeerConnection);
  const second = createSession('beta', Socket, PeerConnection);
  const errors = [];
  second.subscribe(event => { if (event.type === 'error') errors.push(event.error.code); });
  context.after(async () => { await first.dispose(); await second.dispose(); await server.dispose(); });
  await Promise.all([first.start(), second.start()]);
  await waitFor(() => first.transport.metrics.connectedPeers === 1 && second.transport.metrics.connectedPeers === 1);
  const channel = PeerConnection.instances.find(connection => connection.offered).channel;
  const codec = new PeerFrameCodec();
  const forged = document('impostor').insert(0, 'forged');
  for (const frame of codec.encode(JSON.stringify(collaborationMessage('update', { update: forged })))) channel.send(frame);
  await waitFor(() => errors.includes('Auth'));
  assert.equal(second.document.text, '');
  first.transport.connectPeer('beta');
  await waitFor(() => first.transport.metrics.connectedPeers === 1 && second.transport.metrics.connectedPeers === 1);
  const next = PeerConnection.instances.filter(connection => connection.offered).at(-1).channel;
  const foreign = document('alpha', { workspaceId: 'another' }).insert(0, 'foreign');
  for (const frame of codec.encode(JSON.stringify(collaborationMessage('update', { update: foreign })))) next.send(frame);
  await waitFor(() => errors.length >= 2);
  assert.equal(second.document.text, '');
  codec.dispose();
});

test('signaling disconnect tears down peer authorization and unknown peers cannot be dialed', async context => {
  const server = new CollabRoomServer({ authorize });
  const Socket = socketConstructor(server);
  const PeerConnection = peerConnectionFixture();
  const first = createSession('alpha', Socket, PeerConnection);
  const second = createSession('beta', Socket, PeerConnection);
  context.after(async () => { await first.dispose(); await second.dispose(); await server.dispose(); });
  await Promise.all([first.start(), second.start()]);
  await waitFor(() => first.transport.metrics.connectedPeers === 1 && second.transport.metrics.connectedPeers === 1);
  assert.throws(() => first.transport.connectPeer('outside'), error => error.code === 'Auth');
  Socket.instances.find(socket => JSON.parse(socket.sent[0]).identity.clientId === 'alpha').cut();
  await waitFor(() => first.transport.metrics.connectedPeers === 0 && second.transport.metrics.connectedPeers === 0);
  assert(PeerConnection.instances.every(connection => connection.closed));
});

test('peer diagnostics expose missing ICE and native state without SDP, candidate endpoints or credentials', async context => {
  const states = [];
  class Connection {
    connectionState = 'connecting';
    iceConnectionState = 'checking';
    iceGatheringState = 'complete';
    signalingState = 'stable';
    localDescription = { type: 'offer', sdp: 'private-local-ice-password' };
    remoteDescription = { type: 'answer', sdp: 'private-remote-ice-password' };
    async addIceCandidate() {}
    close() { this.connectionState = 'closed'; }
  }
  const peer = new CollaborationPeer({ identity: identity('alpha'), remoteId: 'beta', sessionId: 'rtc-1',
    PeerConnection: Connection, maximumBytes: 4096, sendSignal() {}, onData() {},
    onState: event => states.push(event), onError: error => { throw error; } });
  context.after(() => peer.dispose());
  assert.equal(peer.diagnostics.localCandidates, 0);
  assert.equal(peer.diagnostics.remoteCandidates, 0);
  assert.equal(peer.diagnostics.iceGatheringState, 'complete');
  assert.equal(peer.diagnostics.ready, false);
  const candidate = { candidate: 'candidate:1 1 udp 100 192.0.2.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
  peer.connection.onicecandidate({ candidate: { toJSON: () => candidate } });
  peer.connection.onicecandidateerror({ errorCode: 701, url: 'turn:private-endpoint', errorText: 'private-detail' });
  peer.signal({ sessionId: 'rtc-1', candidate });
  await waitFor(() => peer.diagnostics.remoteCandidates === 1);
  assert.equal(peer.diagnostics.localCandidates, 1);
  assert.equal(peer.diagnostics.lastIceErrorCode, 701);
  assert.equal(peer.diagnostics.localDescriptionType, 'offer');
  assert.equal(peer.diagnostics.remoteDescriptionType, 'answer');
  assert.equal(peer.diagnostics.iceConnectionState, 'checking');
  const encoded = JSON.stringify(peer.diagnostics);
  for (const secret of ['private-', '192.0.2.1', 'candidate:1', '50000']) assert.equal(encoded.includes(secret), false);
  peer.dispose();
  assert.equal(peer.connection.onicecandidateerror, null);
  assert.equal(states.at(-1).diagnostics.disposed, true);
  assert.equal(states.at(-1).diagnostics.localCandidates, 1);
});

function createSession(clientId, Socket, PeerConnection) {
  const value = identity(clientId);
  const signaling = new WebSocketCollabTransport({
    identity: value, url: 'wss://collaboration.example.test/collab', WebSocket: Socket,
    tokenProvider: () => tokenFor(value), assertOrigin() {}, heartbeatMs: 0, retryMinimumMs: 10000, retryMaximumMs: 10000
  });
  const transport = new WebRtcCollabTransport({ signaling, RTCPeerConnection: PeerConnection });
  return new CollabSession({ document: document(clientId), identity: value, transport, ownDocument: true, presenceHeartbeatMs: 0 });
}

// A signaling/state-machine fixture only. The Python scenario independently qualifies native DTLS/SCTP and browser ICE.
function peerConnectionFixture() {
  const offers = new Map();
  return class PeerConnection {
    static instances = [];
    connectionState = 'new';
    localDescription = null;
    remoteDescription = null;
    offered = false;
    closed = false;

    constructor() {
      this.id = this.constructor.instances.length + 1;
      this.constructor.instances.push(this);
    }

    createDataChannel(label, options) {
      this.channel = new Channel(label, options);
      return this.channel;
    }

    async createOffer() {
      this.offered = true;
      offers.set('fixture-offer-' + this.id, this);
      return { type: 'offer', sdp: 'fixture-offer-' + this.id };
    }

    async createAnswer() {
      return { type: 'answer', sdp: 'fixture-answer-' + this.id };
    }

    async setLocalDescription(value) {
      this.localDescription = { ...value };
    }

    async setRemoteDescription(value) {
      this.remoteDescription = { ...value };
      if (value.type === 'offer') {
        const source = offers.get(value.sdp);
        assert(source);
        source.partner = this;
        this.partner = source;
        this.channel = new Channel(source.channel.label, { protocol: source.channel.protocol, ordered: true });
        this.channel.partner = source.channel;
        source.channel.partner = this.channel;
        this.ondatachannel?.({ channel: this.channel });
      } else {
        this.connectionState = this.partner.connectionState = 'connected';
        this.channel.readyState = this.partner.channel.readyState = 'open';
        queueMicrotask(() => { this.channel.onopen?.(); this.partner.channel.onopen?.(); });
      }
    }

    async addIceCandidate() {
      assert(this.remoteDescription);
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.connectionState = 'closed';
      this.channel?.close();
      this.onconnectionstatechange?.();
    }
  };
}

class Channel {
  readyState = 'connecting';
  bufferedAmount = 0;

  constructor(label, { ordered, protocol }) {
    this.label = label;
    this.ordered = ordered;
    this.protocol = protocol;
  }

  send(data) {
    assert.equal(this.readyState, 'open');
    const copy = typeof data === 'string' ? data : data.slice().buffer;
    queueMicrotask(() => {
      if (this.partner?.readyState === 'open') this.partner.onmessage?.({ data: copy });
    });
  }

  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.onclose?.();
    if (this.partner && this.partner.readyState !== 'closed') this.partner.close();
  }
}
