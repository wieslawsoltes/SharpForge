import { GitError, checkLimit } from '../errors.js';
import { byteChunks, concatBytes, encodeText, decodeText } from './bytes.js';

export const PacketKind = Object.freeze({ Data: 'data', Flush: 'flush', Delimiter: 'delimiter', End: 'end', Raw: 'raw' });
export const MAX_PACKET_BYTES = 65520;
const controlCodes = Object.freeze({ flush: '0000', delimiter: '0001', end: '0002' });

/** Encode a pkt-line, including control packets. Maximum encoded size is 65,520 bytes. */
export function encodePktLine(value, { maximum = MAX_PACKET_BYTES } = {}) {
  if (typeof value === 'object' && value?.kind in controlCodes) return encodeText(controlCodes[value.kind]);
  const payload = typeof value === 'string' ? encodeText(value) : value;
  if (!(payload instanceof Uint8Array)) throw new GitError('Corrupt', 'Pkt-line payload must be bytes or text');
  const length = checkLimit(payload.length + 4, Math.min(maximum, MAX_PACKET_BYTES), 'Pkt-line');
  const output = new Uint8Array(length);
  output.set(encodeText(length.toString(16).padStart(4, '0')));
  output.set(payload, 4);
  return output;
}

export const flushPacket = () => encodePktLine({ kind: PacketKind.Flush });
export const delimiterPacket = () => encodePktLine({ kind: PacketKind.Delimiter });
export const responseEndPacket = () => encodePktLine({ kind: PacketKind.End });

/** Incremental framing. Incomplete headers/payloads remain bounded by one maximum packet. */
export class PktLineDecoder {
  constructor({ maximum = MAX_PACKET_BYTES, allowRawPack = false } = {}) {
    this.maximum = Math.min(maximum, MAX_PACKET_BYTES);
    this.allowRawPack = allowRawPack;
    this.pending = new Uint8Array(0);
    this.raw = false;
  }

  push(chunk) {
    if (!(chunk instanceof Uint8Array)) throw new GitError('Corrupt', 'Pkt-line input must be bytes');
    if (this.raw) return chunk.length ? [{ kind: PacketKind.Raw, data: chunk }] : [];
    const bytes = this.pending.length ? concatBytes([this.pending, chunk]) : chunk;
    const packets = [];
    let offset = 0;
    while (offset + 4 <= bytes.length) {
      const header = String.fromCharCode(...bytes.subarray(offset, offset + 4));
      if (this.allowRawPack && header === 'PACK') {
        this.raw = true;
        packets.push({ kind: PacketKind.Raw, data: bytes.subarray(offset) });
        offset = bytes.length;
        break;
      }
      if (!/^[0-9a-fA-F]{4}$/.test(header)) throw new GitError('Corrupt', 'Invalid pkt-line length');
      const length = Number.parseInt(header, 16);
      if (length === 3 || length > this.maximum) throw new GitError('Corrupt', 'Invalid pkt-line size', { length });
      if (length <= 2) {
        packets.push({ kind: [PacketKind.Flush, PacketKind.Delimiter, PacketKind.End][length] });
        offset += 4;
        continue;
      }
      if (offset + length > bytes.length) break;
      packets.push({ kind: PacketKind.Data, data: bytes.subarray(offset + 4, offset + length) });
      offset += length;
    }
    this.pending = bytes.slice(offset);
    checkLimit(this.pending.length, this.maximum, 'Incomplete pkt-line');
    return packets;
  }

  finish() {
    if (this.pending.length) throw new GitError('Corrupt', 'Truncated pkt-line', { remaining: this.pending.length });
  }
}

/** Decode framing while consuming at most one network chunk and incomplete packet at a time. */
export async function* decodePktLines(source, options = {}) {
  const decoder = new PktLineDecoder(options);
  for await (const chunk of byteChunks(source, options)) yield* decoder.push(chunk);
  decoder.finish();
}

/** Decode sideband channel 1/2/3. Fatal remote messages become typed network failures. */
export function decodeSideband(packet, { onProgress } = {}) {
  if (packet.kind !== PacketKind.Data) return packet;
  if (!packet.data.length) throw new GitError('Corrupt', 'Sideband packet has no channel');
  const channel = packet.data[0];
  const data = packet.data.subarray(1);
  if (channel === 1) return { kind: PacketKind.Data, data };
  if (channel === 2) {
    onProgress?.({ phase: 'remote', message: decodeText(data) });
    return null;
  }
  if (channel === 3) throw new GitError('Network', 'Remote Git service failed', { remoteMessage: decodeText(data) });
  throw new GitError('Corrupt', 'Unknown sideband channel', { channel });
}

export function encodePackets(lines, { end = PacketKind.Flush } = {}) {
  const packets = lines.map(line => encodePktLine(line));
  if (end) packets.push(encodePktLine({ kind: end }));
  return concatBytes(packets, 16 * 1024 * 1024);
}
