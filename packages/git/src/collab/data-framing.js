import { GitError, checkLimit } from '../errors.js';

const HEADER_BYTES = 16;
const MAGIC = 0x53464331;

/** Bounded binary fragmentation avoids browser SCTP message-size differences. */
export class PeerFrameCodec {
  #nextTransfer = 0;
  #transfers = new Map();
  #bufferedBytes = 0;
  #disposed = false;

  constructor({ maximumBytes = 2 * 1024 * 1024 + 4096, fragmentBytes = 16384, maximumTransfers = 8 } = {}) {
    checkLimit(fragmentBytes, 65536, 'WebRTC fragment bytes');
    if (fragmentBytes <= HEADER_BYTES) throw new GitError('Limit', 'WebRTC fragment is smaller than its header');
    checkLimit(maximumBytes, 64 * 1024 * 1024, 'WebRTC message bytes');
    checkLimit(maximumTransfers, 1024, 'WebRTC pending transfers');
    this.maximumBytes = maximumBytes;
    this.fragmentBytes = fragmentBytes;
    this.maximumTransfers = maximumTransfers;
  }

  encode(text) {
    if (this.#disposed) throw new GitError('Disposed', 'WebRTC frame codec is disposed');
    if (typeof text !== 'string') throw new GitError('Corrupt', 'WebRTC frame payload must be text');
    const bytes = new TextEncoder().encode(text);
    checkLimit(bytes.length, this.maximumBytes, 'WebRTC message bytes');
    const payloadSize = this.fragmentBytes - HEADER_BYTES;
    const total = Math.max(1, Math.ceil(bytes.length / payloadSize));
    checkLimit(total, 65535, 'WebRTC fragment count');
    const transferId = this.#nextTransfer++ >>> 0;
    const frames = [];
    for (let index = 0; index < total; index++) {
      const start = index * payloadSize;
      const payload = bytes.subarray(start, Math.min(start + payloadSize, bytes.length));
      const frame = new Uint8Array(HEADER_BYTES + payload.length);
      const header = new DataView(frame.buffer);
      header.setUint32(0, MAGIC);
      header.setUint32(4, transferId);
      header.setUint16(8, index);
      header.setUint16(10, total);
      header.setUint32(12, bytes.length);
      frame.set(payload, HEADER_BYTES);
      frames.push(frame);
    }
    return frames;
  }

  receive(input) {
    if (this.#disposed) throw new GitError('Disposed', 'WebRTC frame codec is disposed');
    const frame = input instanceof ArrayBuffer ? new Uint8Array(input) : input instanceof Uint8Array ? input : null;
    if (!frame || frame.length < HEADER_BYTES || frame.length > this.fragmentBytes) throw new GitError('Corrupt', 'Invalid WebRTC frame size');
    const header = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    if (header.getUint32(0) !== MAGIC) throw new GitError('Corrupt', 'Invalid WebRTC frame signature');
    const transferId = header.getUint32(4);
    const index = header.getUint16(8);
    const total = header.getUint16(10);
    const length = header.getUint32(12);
    const payloadSize = this.fragmentBytes - HEADER_BYTES;
    checkLimit(length, this.maximumBytes, 'WebRTC received message bytes');
    if (!total || index >= total || total !== Math.max(1, Math.ceil(length / payloadSize))) {
      throw new GitError('Corrupt', 'Invalid WebRTC fragment sequence');
    }
    const expected = Math.min(payloadSize, length - index * payloadSize);
    if (frame.length - HEADER_BYTES !== expected) throw new GitError('Corrupt', 'WebRTC fragment payload length disagrees');
    let transfer = this.#transfers.get(transferId);
    if (!transfer) {
      checkLimit(this.#transfers.size + 1, this.maximumTransfers, 'WebRTC pending transfers');
      checkLimit(this.#bufferedBytes + length, this.maximumBytes * 2, 'WebRTC pending transfer bytes');
      transfer = { bytes: new Uint8Array(length), seen: new Set(), length, total };
      this.#transfers.set(transferId, transfer);
      this.#bufferedBytes += length;
    }
    if (transfer.length !== length || transfer.total !== total) throw new GitError('Conflict', 'WebRTC transfer metadata changed');
    const offset = index * payloadSize;
    const payload = frame.subarray(HEADER_BYTES);
    if (transfer.seen.has(index)) {
      for (let cursor = 0; cursor < payload.length; cursor++) {
        if (transfer.bytes[offset + cursor] !== payload[cursor]) throw new GitError('Conflict', 'WebRTC fragment was reused');
      }
      return null;
    }
    transfer.bytes.set(payload, offset);
    transfer.seen.add(index);
    if (transfer.seen.size !== transfer.total) return null;
    this.#transfers.delete(transferId);
    this.#bufferedBytes -= transfer.length;
    return transfer.bytes;
  }

  dispose() {
    this.#disposed = true;
    this.#transfers.clear();
    this.#bufferedBytes = 0;
  }
}
