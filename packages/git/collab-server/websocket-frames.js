import { Buffer } from 'node:buffer';

/** RFC 6455 server framing: client masking, fragmented text/binary, ping/pong and bounded messages. */
export class CollaborationWebSocket {
  #buffer = Buffer.alloc(0);
  #fragments = [];
  #fragmentBytes = 0;
  #fragmentKind = 0;
  #processing = false;
  #closed = false;
  #closeTimer = null;
  #authority = null;

  constructor(socket, { maximumBytes, context }) {
    this.socket = socket;
    this.maximumBytes = maximumBytes;
    this.context = context;
    socket.on('data', data => this.feed(data));
    socket.on('error', () => this.#ended());
    socket.on('close', () => this.#ended());
    socket.setTimeout(120000, () => this.close(1001, 'Idle connection'));
  }

  bind(authority) {
    this.#authority = authority;
  }

  feed(data) {
    if (this.#closed) return;
    if (this.#buffer.length + data.length > this.maximumBytes + 65550) { this.close(1009, 'Frame buffer limit'); return; }
    this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, data]) : data;
    this.#drain();
  }

  #drain() {
    if (this.#processing || this.#closed) return;
    try {
      while (!this.#processing && !this.#closed) {
        const frame = this.#parseFrame();
        if (!frame) break;
        this.#frame(frame);
      }
    } catch (error) {
      this.close(error?.code === 'MESSAGE_LIMIT' ? 1009 : 1002, 'Invalid WebSocket frame');
    }
  }

  #parseFrame() {
    const buffer = this.#buffer;
    if (buffer.length < 2) return null;
    const final = (buffer[0] & 0x80) !== 0;
    const opcode = buffer[0] & 0x0f;
    if (buffer[0] & 0x70 || !(buffer[1] & 0x80)) throw new Error('Client frame must be masked without extensions');
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return null;
      length = buffer.readUInt16BE(2);
      if (length < 126) throw new Error('Non-minimal frame length');
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return null;
      const large = buffer.readBigUInt64BE(2);
      if (large > BigInt(this.maximumBytes)) throw limitError();
      length = Number(large);
      if (length < 65536) throw new Error('Non-minimal frame length');
      offset = 10;
    }
    if (length > this.maximumBytes) throw limitError();
    if (opcode >= 8 && (!final || length > 125)) throw new Error('Invalid control frame');
    if (buffer.length < offset + 4 + length) return null;
    const payload = Buffer.allocUnsafe(length);
    for (let index = 0; index < length; index++) payload[index] = buffer[offset + 4 + index] ^ buffer[offset + (index & 3)];
    this.#buffer = buffer.subarray(offset + 4 + length);
    return { final, opcode, payload };
  }

  #frame({ final, opcode, payload }) {
    if (opcode === 8) {
      if (payload.length === 1) throw new Error('Invalid close payload');
      if (payload.length >= 2) {
        const code = payload.readUInt16BE(0);
        if (code < 1000 || code >= 5000 || [1004, 1005, 1006, 1015].includes(code)) throw new Error('Invalid close code');
        new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(2));
      }
      this.close(1000, 'Peer closed');
      return;
    }
    if (opcode === 9) { this.socket.write(encodeFrame(payload, 10)); return; }
    if (opcode === 10) return;
    if (![0, 1, 2].includes(opcode)) throw new Error('Unknown frame opcode');
    if (opcode === 0 && !this.#fragmentKind || opcode !== 0 && this.#fragmentKind) throw new Error('Invalid fragment sequence');
    if (opcode !== 0) this.#fragmentKind = opcode;
    this.#fragmentBytes += payload.length;
    if (this.#fragmentBytes > this.maximumBytes || this.#fragments.length >= 4096) throw limitError();
    this.#fragments.push(payload);
    if (!final) return;
    const message = this.#fragments.length === 1 ? payload : Buffer.concat(this.#fragments, this.#fragmentBytes);
    if (this.#fragmentKind === 1) new TextDecoder('utf-8', { fatal: true }).decode(message);
    this.#fragments = [];
    this.#fragmentBytes = 0;
    this.#fragmentKind = 0;
    this.#processing = true;
    this.socket.pause();
    Promise.resolve(this.#authority.receive(message)).finally(() => {
      this.#processing = false;
      if (!this.#closed) {
        this.#drain();
        if (!this.#processing) this.socket.resume();
      }
    }).catch(() => this.close(1011, 'Message processing failed'));
  }

  async send(text) {
    if (this.#closed || this.socket.destroyed) throw new Error('Socket closed');
    const payload = Buffer.from(text, 'utf8');
    if (payload.length > this.maximumBytes) throw limitError();
    if (this.socket.write(encodeFrame(payload, 1))) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        this.socket.off('drain', drained);
        this.socket.off('close', failed);
        this.socket.off('error', failed);
      };
      const drained = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('Socket closed before drain')); };
      this.socket.once('drain', drained);
      this.socket.once('close', failed);
      this.socket.once('error', failed);
    });
  }

  close(code = 1000, reason = 'Closed') {
    if (this.#closed) return;
    this.#closed = true;
    const text = Buffer.from(reason, 'utf8').subarray(0, 123);
    const payload = Buffer.allocUnsafe(2 + text.length);
    payload.writeUInt16BE(code, 0);
    text.copy(payload, 2);
    if (!this.socket.destroyed) {
      // Authentication can reject while reads are paused. Drain the peer's close/FIN and bound an unresponsive peer.
      this.#closeTimer = setTimeout(() => { this.#closeTimer = null; this.socket.destroy(); }, 1000);
      this.#closeTimer.unref?.();
      this.socket.end(encodeFrame(payload, 8));
      this.socket.resume();
    }
    this.#buffer = Buffer.alloc(0);
    this.#fragments = [];
    this.#authority?.close();
  }

  #ended() {
    if (!this.#closed) this.close(1001, 'Connection ended');
    clearTimeout(this.#closeTimer);
    this.#closeTimer = null;
    this.#authority?.close();
  }
}

function encodeFrame(payload, opcode) {
  const headerBytes = payload.length < 126 ? 2 : payload.length < 65536 ? 4 : 10;
  const frame = Buffer.allocUnsafe(headerBytes + payload.length);
  frame[0] = 0x80 | opcode;
  if (headerBytes === 2) frame[1] = payload.length;
  else if (headerBytes === 4) { frame[1] = 126; frame.writeUInt16BE(payload.length, 2); }
  else { frame[1] = 127; frame.writeBigUInt64BE(BigInt(payload.length), 2); }
  payload.copy(frame, headerBytes);
  return frame;
}

function limitError() {
  const error = new Error('WebSocket message limit');
  error.code = 'MESSAGE_LIMIT';
  return error;
}
