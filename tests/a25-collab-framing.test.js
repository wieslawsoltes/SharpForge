import test from 'node:test';
import assert from 'node:assert/strict';
import { WebRtcCollabTransport } from '../packages/git/src/collab/webrtc-transport.js';
import { PeerFrameCodec } from '../packages/git/src/collab/data-framing.js';
import { identity, deferred, settle } from './helpers/a25-collab.js';

test('WebRTC fragmentation handles reverse order and duplicates while rejecting conflicting or oversized fragments', () => {
  const encoder = new PeerFrameCodec({ fragmentBytes: 128, maximumBytes: 10000 });
  const decoder = new PeerFrameCodec({ fragmentBytes: 128, maximumBytes: 10000 });
  const text = '😀abc'.repeat(100);
  const frames = encoder.encode(text);
  assert(frames.length > 2);
  assert.equal(decoder.receive(frames.at(-1)), null);
  assert.equal(decoder.receive(frames.at(-1)), null);
  let complete;
  for (const frame of frames.slice(0, -1).reverse()) complete = decoder.receive(frame) ?? complete;
  assert.equal(new TextDecoder().decode(complete), text);
  const another = encoder.encode('another'.repeat(100));
  decoder.receive(another[0]);
  const conflicting = another[0].slice();
  conflicting[conflicting.length - 1] ^= 1;
  assert.throws(() => decoder.receive(conflicting), error => error.code === 'Conflict');
  assert.throws(() => decoder.receive(new Uint8Array(4)), error => error.code === 'Corrupt');
  assert.throws(() => encoder.encode('x'.repeat(10001)), error => error.code === 'Limit');
  encoder.dispose();
  assert.throws(() => encoder.encode('closed'), error => error.code === 'Disposed');
});

test('WebRTC waits for explicit asynchronous STUN/TURN grants and unavailable engines are not reported as supported', async () => {
  let started = 0;
  const signaling = { identity: identity('rtc'), send() {}, subscribe: () => () => {}, start: () => { started++; }, dispose() {} };
  const pending = deferred();
  const rtc = new WebRtcCollabTransport({ signaling, RTCPeerConnection: class {},
    rtcConfiguration: { iceServers: [{ urls: 'turns:relay.example.test:5349' }] }, assertIceServer: () => pending.promise });
  const starting = rtc.start();
  await settle();
  assert.equal(started, 0);
  pending.resolve();
  await starting;
  assert.equal(started, 1);
  rtc.dispose();
  const missing = new WebRtcCollabTransport({ signaling, RTCPeerConnection: false });
  await assert.rejects(missing.start(), error => error.code === 'Unsupported');
  missing.dispose();
  const denied = new WebRtcCollabTransport({ signaling, RTCPeerConnection: class {},
    rtcConfiguration: { iceServers: [{ urls: 'stun:relay.example.test' }] } });
  await assert.rejects(denied.start(), error => error.code === 'Unsafe');
  denied.dispose();
});
