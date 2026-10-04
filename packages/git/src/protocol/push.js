import { GitError, checkLimit } from '../errors.js';
import { getObjectFormat } from '../object-format.js';
import { validateRefName } from '../refs/names.js';
import { gitRequest, gitServiceUrl } from '../transport/request.js';
import { validateWireOid } from './advertisement.js';
import { encodePktLine, flushPacket, decodePktLines, decodeSideband, PktLineDecoder, PacketKind } from './pktline.js';
import { concatBytes, decodeText, byteChunks } from './bytes.js';

/** Build receive-pack commands and negotiated capabilities, retaining old IDs as server-side leases. */
export function buildPushCommands({ updates, remote, algorithm = 'sha1', atomic = true, pushOptions = [], onProgress }) {
  const capabilities = [];
  if (remote.capabilities.has('report-status-v2')) capabilities.push('report-status-v2');
  else if (remote.capabilities.has('report-status')) capabilities.push('report-status');
  else throw new GitError('Unsupported', 'Remote does not provide push status reports');
  if (atomic) {
    if (!remote.capabilities.has('atomic')) throw new GitError('Unsupported', 'Remote does not support atomic push');
    capabilities.push('atomic');
  }
  if (remote.capabilities.has('ofs-delta')) capabilities.push('ofs-delta');
  if (remote.capabilities.has('side-band-64k')) capabilities.push('side-band-64k');
  if (!onProgress && remote.capabilities.has('quiet')) capabilities.push('quiet');
  if (remote.capabilities.has('object-format')) capabilities.push(`object-format=${algorithm}`);
  if (pushOptions.length) {
    if (!remote.capabilities.has('push-options')) throw new GitError('Unsupported', 'Remote does not support push options');
    capabilities.push('push-options');
  }
  const zero = getObjectFormat(algorithm).zeroOid;
  const names = new Set();
  checkLimit(updates.length, 100_000, 'Push references');
  const packets = updates.map((update, index) => {
    validateRefName(update.name);
    if (names.has(update.name)) throw new GitError('Conflict', 'Push updates a reference twice');
    names.add(update.name);
    const oldOid = validateWireOid(update.oldOid ?? zero, algorithm);
    const newOid = validateWireOid(update.newOid ?? zero, algorithm);
    if (newOid === zero && !remote.capabilities.has('delete-refs')) throw new GitError('Unsupported', 'Remote does not allow reference deletion');
    return encodePktLine(`${oldOid} ${newOid} ${update.name}${index === 0 ? `\0${capabilities.join(' ')}` : ''}\n`);
  });
  packets.push(flushPacket());
  if (pushOptions.length) {
    for (const value of pushOptions) {
      if (typeof value !== 'string' || /[\x00\n]/.test(value)) throw new GitError('Unsafe', 'Push option contains a protocol separator');
      packets.push(encodePktLine(value));
    }
    packets.push(flushPacket());
  }
  return { bytes: concatBytes(packets, 16 * 1024 * 1024), sideband: capabilities.includes('side-band-64k') };
}

function statusPacket(packet, result) {
  if (packet.kind !== PacketKind.Data) return;
  const line = decodeText(packet.data).replace(/\n$/, '');
  if (line.startsWith('unpack ')) {
    result.unpack = line.slice(7);
    return;
  }
  if (line.startsWith('ok ') || line.startsWith('ng ')) {
    const success = line.startsWith('ok ');
    const rest = line.slice(3);
    const separator = rest.indexOf(' ');
    const name = success ? rest : separator < 0 ? rest : rest.slice(0, separator);
    validateRefName(name);
    result.refs.push({ name, ok: success, message: success ? null : separator < 0 ? 'Remote rejected update' : rest.slice(separator + 1), options: [] });
    return;
  }
  if (line.startsWith('option ') && result.refs.length) { result.refs.at(-1).options.push(line.slice(7)); return; }
  if (line.startsWith('ERR ')) throw new GitError('Network', 'Remote receive-pack failed', { remoteMessage: line.slice(4) });
  throw new GitError('Corrupt', 'Invalid push status line', { line });
}

/** Parse status-v1/v2, including status pkt-lines nested within sideband channel one. */
export async function parsePushStatus(source, { sideband = false, onProgress, signal } = {}) {
  const result = { unpack: null, refs: [] };
  const nested = new PktLineDecoder();
  for await (const packet of decodePktLines(source, { signal })) {
    if (!sideband) { statusPacket(packet, result); continue; }
    const decoded = decodeSideband(packet, { onProgress });
    if (decoded?.kind === PacketKind.Data) for (const status of nested.push(decoded.data)) statusPacket(status, result);
  }
  if (sideband) nested.finish();
  if (result.unpack === null) throw new GitError('Corrupt', 'Remote omitted pack unpack status');
  if (result.unpack !== 'ok') throw new GitError('Corrupt', 'Remote could not unpack uploaded objects', { remoteMessage: result.unpack });
  return result;
}

/** Upload command framing followed by the pack. A request body cap protects browser-compatible buffering. */
export async function sendPack(options) {
  const { transport, url, pack, signal, maxRequestBytes = 256 * 1024 * 1024 } = options;
  const commands = buildPushCommands(options);
  const chunks = [commands.bytes];
  let size = commands.bytes.length;
  for await (const chunk of byteChunks(pack ?? new Uint8Array(), { signal })) {
    size = checkLimit(size + chunk.length, maxRequestBytes, 'Push request body');
    chunks.push(chunk);
  }
  const response = await gitRequest(transport, {
    url: gitServiceUrl(url, 'git-receive-pack'), method: 'POST', signal,
    headers: { 'Content-Type': 'application/x-git-receive-pack-request', Accept: 'application/x-git-receive-pack-result' },
    body: concatBytes(chunks, maxRequestBytes)
  });
  const status = await parsePushStatus(response.body ?? response, { ...options, sideband: commands.sideband });
  const expected = new Set(options.updates.map(update => update.name));
  for (const ref of status.refs) {
    if (!expected.delete(ref.name)) throw new GitError('Corrupt', 'Remote returned an unexpected duplicate push ref result');
  }
  if (expected.size) throw new GitError('Corrupt', 'Remote omitted a push reference result');
  const rejected = status.refs.filter(ref => !ref.ok);
  if (rejected.length) throw new GitError('Conflict', 'Remote rejected one or more reference updates', { rejected, atomic: options.atomic !== false });
  return status;
}
