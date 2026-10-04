import { GitError, checkLimit } from '../errors.js';
import { gitRequest, gitServiceUrl } from '../transport/request.js';
import { parseAdvertisement, requireObjectFormat, validateWireOid } from './advertisement.js';
import { encodePktLine, delimiterPacket, flushPacket, decodePktLines, PacketKind } from './pktline.js';
import { concatBytes, decodeText, protocolField } from './bytes.js';

/** Discover a smart HTTP server, requesting v2 and retaining a v0/v1 fallback advertisement. */
export async function discoverRemote({ transport, url, service = 'git-upload-pack', algorithm = 'sha1', signal }) {
  const response = await gitRequest(transport, {
    url: gitServiceUrl(url, service, true), method: 'GET', signal,
    headers: { Accept: `application/x-${service}-advertisement`, 'Git-Protocol': 'version=2' }
  });
  const advertisement = await parseAdvertisement(response.body ?? response, { service, algorithm, signal });
  requireObjectFormat(advertisement, algorithm);
  return advertisement;
}

/** Frame a v2 command. Only server-advertised protocol capabilities are sent. */
export function buildV2Command(command, arguments_, { capabilities = new Map(), algorithm = 'sha1' } = {}) {
  const packets = [encodePktLine(`command=${protocolField(command)}\n`)];
  if (capabilities.has('agent')) packets.push(encodePktLine('agent=sharpforge/0.15\n'));
  if (capabilities.has('object-format')) packets.push(encodePktLine(`object-format=${algorithm}\n`));
  packets.push(delimiterPacket());
  for (const argument of arguments_) packets.push(encodePktLine(`${argument}\n`));
  packets.push(flushPacket());
  return concatBytes(packets, 16 * 1024 * 1024);
}

/** List branches, tags, peeled tag targets and symbolic HEAD across protocol versions. */
export async function listRemoteRefs(options) {
  const { transport, url, algorithm = 'sha1', signal, prefixes = [], maxRefs = 1_000_000 } = options;
  const remote = options.remote ?? await discoverRemote(options);
  if (remote.version !== 2) return { ...remote, refs: remote.refs.filter(ref => !prefixes.length || prefixes.some(p => ref.name.startsWith(p))) };
  if (!remote.capabilities.has('ls-refs')) throw new GitError('Unsupported', 'Remote does not advertise ls-refs');
  const arguments_ = ['symrefs', 'peel', ...prefixes.map(prefix => `ref-prefix ${protocolField(prefix)}`)];
  if (remote.capabilities.get('ls-refs').split(' ').includes('unborn')) arguments_.push('unborn');
  const response = await gitRequest(transport, {
    url: gitServiceUrl(url, 'git-upload-pack'), method: 'POST', signal,
    headers: { 'Content-Type': 'application/x-git-upload-pack-request', Accept: 'application/x-git-upload-pack-result',
      'Git-Protocol': 'version=2' },
    body: buildV2Command('ls-refs', arguments_, remote)
  });
  const refs = [];
  const names = new Set();
  for await (const packet of decodePktLines(response.body ?? response, { signal })) {
    if (packet.kind !== PacketKind.Data) continue;
    const [oid, name, ...attributes] = decodeText(packet.data).replace(/\n$/, '').split(' ');
    if (oid === 'ERR') throw new GitError('Network', 'Remote ls-refs failed', { remoteMessage: [name, ...attributes].join(' ') });
    if (oid !== 'unborn') validateWireOid(oid, algorithm);
    protocolField(name, 'Reference name');
    if (names.has(name)) throw new GitError('Corrupt', 'Remote advertised a duplicate reference', { name });
    names.add(name);
    const ref = { name, oid: oid === 'unborn' ? null : oid };
    for (const attribute of attributes) {
      if (attribute.startsWith('symref-target:')) ref.symref = protocolField(attribute.slice(14));
      if (attribute.startsWith('peeled:')) ref.peeled = validateWireOid(attribute.slice(7), algorithm);
    }
    checkLimit(refs.length + 1, maxRefs, 'Advertised references');
    refs.push(ref);
  }
  return { ...remote, refs };
}
