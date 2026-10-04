import { GitError } from '../errors.js';
import { PeerFrameCodec } from './data-framing.js';
import { decodeJson } from './encoding.js';
import { COLLAB_PROTOCOL_VERSION, validateIdentity, sameRoom, validateIdentityPart } from './validation.js';
import { validateSignal } from './protocol.js';

/** One data channel, with SDP authenticated by the room signaling authority. */
export class CollaborationPeer {
  #channel = null;
  #ready = false;
  #disposed = false;
  #queue = Promise.resolve();
  #offered = false;
  #localCandidates = 0;
  #remoteCandidates = 0;
  #lastIceErrorCode = null;

  constructor(options) {
    this.identity = options.identity;
    this.remoteId = validateIdentityPart(options.remoteId, 'WebRTC remote identity');
    this.sendSignal = options.sendSignal;
    this.onData = options.onData;
    this.onState = options.onState;
    this.onError = options.onError;
    this.sessionId = options.sessionId;
    this.maximumBytes = options.maximumBytes;
    this.frames = new PeerFrameCodec({ maximumBytes: this.maximumBytes });
    this.connection = new options.PeerConnection(options.configuration);
    this.connection.onicecandidate = event => {
      if (!event.candidate || this.#disposed) return;
      const candidate = event.candidate.toJSON ? event.candidate.toJSON() : event.candidate;
      if (candidate.candidate) this.#localCandidates++;
      this.#guard(() => this.sendSignal({ sessionId: this.sessionId, candidate }));
    };
    this.connection.onicecandidateerror = event => {
      if (!this.#disposed && Number.isInteger(event.errorCode)) this.#lastIceErrorCode = event.errorCode;
    };
    this.connection.ondatachannel = event => this.#guard(() => this.#bind(event.channel));
    this.connection.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(this.connection.connectionState)) this.dispose();
    };
  }

  get ready() {
    return this.#ready && !this.#disposed;
  }

  /** Connection state only: never expose SDP, ICE addresses/passwords or credential-bearing URLs. */
  get diagnostics() {
    return Object.freeze({
      clientId: this.remoteId, sessionId: this.sessionId, ready: this.ready, disposed: this.#disposed,
      connectionState: this.connection.connectionState ?? null,
      iceConnectionState: this.connection.iceConnectionState ?? null,
      iceGatheringState: this.connection.iceGatheringState ?? null,
      signalingState: this.connection.signalingState ?? null,
      dataChannelState: this.#channel?.readyState ?? null,
      localDescriptionType: this.connection.localDescription?.type ?? null,
      remoteDescriptionType: this.connection.remoteDescription?.type ?? null,
      localCandidates: this.#localCandidates, remoteCandidates: this.#remoteCandidates,
      lastIceErrorCode: this.#lastIceErrorCode
    });
  }

  initiate() {
    if (this.#disposed || this.#offered) return;
    if (this.identity.clientId > this.remoteId) {
      this.sendSignal({ sessionId: this.sessionId, request: true });
      return;
    }
    this.#offered = true;
    this.#bind(this.connection.createDataChannel('sharpforge-collab', { ordered: true, protocol: 'sharpforge.collab.v1' }));
    this.#schedule(async () => {
      const offer = await this.connection.createOffer();
      if (this.#disposed) return;
      await this.connection.setLocalDescription(offer);
      if (this.#disposed) return;
      this.sendSignal({ sessionId: this.sessionId, description: this.connection.localDescription.toJSON?.() ?? this.connection.localDescription });
    });
  }

  signal(input) {
    const signal = validateSignal(input);
    if (signal.request) {
      this.initiate();
      return;
    }
    this.#schedule(async () => {
      if (signal.description?.type === 'offer') {
        if (this.identity.clientId < this.remoteId || this.#offered) throw new GitError('Auth', 'Unexpected WebRTC offer owner');
        this.sessionId = signal.sessionId;
        this.#offered = true;
        await this.connection.setRemoteDescription(signal.description);
        if (this.#disposed) return;
        const answer = await this.connection.createAnswer();
        if (this.#disposed) return;
        await this.connection.setLocalDescription(answer);
        if (this.#disposed) return;
        this.sendSignal({ sessionId: this.sessionId, description: this.connection.localDescription.toJSON?.() ?? this.connection.localDescription });
      } else {
        if (signal.sessionId !== this.sessionId) throw new GitError('Auth', 'WebRTC signal belongs to another session');
        if (signal.description) await this.connection.setRemoteDescription(signal.description);
        else {
          await this.connection.addIceCandidate(signal.candidate);
          if (signal.candidate.candidate) this.#remoteCandidates++;
        }
      }
    });
  }

  send(text) {
    if (!this.ready || this.#channel.readyState !== 'open') return false;
    const frames = this.frames.encode(text);
    const requiredBytes = frames.reduce((sum, frame) => sum + frame.byteLength, 0);
    if (this.#channel.bufferedAmount + requiredBytes > this.maximumBytes * 4) return false;
    try {
      for (const frame of frames) this.#channel.send(frame);
    } catch {
      this.dispose();
      this.onError(new GitError('Network', 'WebRTC direct delivery failed; durable transport remains available'));
      return false;
    }
    return true;
  }

  #bind(channel) {
    if (this.#channel || channel.label !== 'sharpforge-collab' || channel.protocol !== 'sharpforge.collab.v1' || channel.ordered === false) {
      channel.close();
      throw new GitError('Auth', 'Unexpected collaboration data channel');
    }
    this.#channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => this.#guard(() => {
      channel.send(JSON.stringify({ type: 'peer-auth', version: COLLAB_PROTOCOL_VERSION, identity: this.identity, sessionId: this.sessionId }));
    });
    channel.onmessage = event => this.#guard(() => this.#receive(event.data));
    channel.onerror = () => this.#guard(() => { throw new GitError('Network', 'WebRTC data channel failed'); });
    channel.onclose = () => this.dispose();
  }

  #receive(data) {
    if (!this.#ready) {
      const message = decodeJson(data, 4096);
      const identity = validateIdentity(message.identity);
      if (message.type !== 'peer-auth' || message.version !== COLLAB_PROTOCOL_VERSION || !sameRoom(identity, this.identity)
        || identity.clientId !== this.remoteId || message.sessionId !== this.sessionId) {
        throw new GitError('Auth', 'WebRTC peer identity does not match authenticated signaling');
      }
      this.#ready = true;
      this.onState({ type: 'peer-open', clientId: this.remoteId, diagnostics: this.diagnostics });
      return;
    }
    const complete = this.frames.receive(data);
    if (complete) this.onData(complete);
  }

  #schedule(action) {
    this.#queue = this.#queue.then(() => {
      if (!this.#disposed) return action();
    }).catch(error => {
      this.dispose();
      this.onError(error);
    });
  }

  #guard(action) {
    if (this.#disposed) return;
    try {
      action();
    } catch (error) {
      this.dispose();
      this.onError(error);
    }
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#ready = false;
    this.frames.dispose();
    if (this.#channel) {
      this.#channel.onopen = this.#channel.onmessage = this.#channel.onerror = this.#channel.onclose = null;
      this.#channel.close();
    }
    this.connection.onicecandidate = this.connection.onicecandidateerror = this.connection.ondatachannel = this.connection.onconnectionstatechange = null;
    this.connection.close();
    this.onState({ type: 'peer-close', clientId: this.remoteId, diagnostics: this.diagnostics });
  }
}
