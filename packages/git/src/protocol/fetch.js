import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { gitRequest, gitServiceUrl } from '../transport/request.js';
import { validateWireOid, requireObjectFormat } from './advertisement.js';
import { buildV2Command, listRemoteRefs } from './v2.js';
import { buildV1FetchRequest } from './v1.js';
import { decodePktLines, decodeSideband, PacketKind } from './pktline.js';
import { decodeText } from './bytes.js';
import { shallowArguments } from '../shallow.js';
import { validateFilter } from '../promisor.js';

function fetchArguments(options, remote) {
  const { wants, haves = [], algorithm = 'sha1', filter, done = true } = options;
  const features = new Set(remote.capabilities.get('fetch')?.split(' ') ?? []);
  const arguments_ = ['thin-pack', 'ofs-delta'];
  if (!options.onProgress) arguments_.push('no-progress');
  if (options.includeTag !== false) arguments_.push('include-tag');
  for (const oid of wants) arguments_.push(`want ${validateWireOid(oid, algorithm)}`);
  for (const oid of haves) arguments_.push(`have ${validateWireOid(oid, algorithm)}`);
  const shallow = shallowArguments(options);
  if (shallow.length && !features.has('shallow')) throw new GitError('Unsupported', 'Remote does not support shallow fetch');
  arguments_.push(...shallow);
  if (filter) {
    if (!features.has('filter')) throw new GitError('Unsupported', 'Remote does not support partial clone filters');
    arguments_.push(`filter ${validateFilter(filter)}`);
  }
  if (!done && features.has('wait-for-done')) arguments_.push('wait-for-done');
  if (done) arguments_.push('done');
  return arguments_;
}

function parseMetadataLine(line, state, algorithm) {
  if (line === 'NAK' || line === 'ready') { state.ready ||= line === 'ready'; return; }
  if (line.startsWith('ACK ')) {
    const [oid, status] = line.slice(4).split(' ');
    state.acknowledgments.push({ oid: validateWireOid(oid, algorithm), status: status ?? null });
    state.ready ||= status === 'ready';
    return;
  }
  if (line.startsWith('shallow ') || line.startsWith('unshallow ')) {
    const [kind, oid] = line.split(' ');
    state[kind].push(validateWireOid(oid, algorithm));
    return;
  }
  if (state.section === 'wanted-refs') {
    const separator = line.indexOf(' ');
    if (separator < 0) throw new GitError('Corrupt', 'Malformed wanted-ref line');
    state.wantedRefs.push({ oid: validateWireOid(line.slice(0, separator), algorithm), name: line.slice(separator + 1) });
    return;
  }
  throw new GitError('Corrupt', 'Unexpected fetch response line', { section: state.section, line });
}

/** Streaming pack channel. Metadata is updated while the caller consumes pack bytes. */
async function* unpackResponse(source, state, options) {
  const { version, sideband, algorithm = 'sha1', signal, onProgress } = options;
  const sections = new Set(['acknowledgments', 'shallow-info', 'wanted-refs', 'packfile']);
  for await (const packet of decodePktLines(source, { signal, allowRawPack: version !== 2 })) {
    if (packet.kind === PacketKind.Raw) { state.hasPack = true; yield packet.data; continue; }
    if (packet.kind === PacketKind.Delimiter) { state.section = null; continue; }
    if (packet.kind !== PacketKind.Data) continue;
    if (state.section === 'packfile' || (version !== 2 && sideband && packet.data[0] <= 3)) {
      const part = decodeSideband(packet, { onProgress });
      if (part?.data.length) { state.hasPack = true; yield part.data; }
      continue;
    }
    const line = decodeText(packet.data).replace(/\n$/, '');
    if (line.startsWith('ERR ')) throw new GitError('Network', 'Remote fetch failed', { remoteMessage: line.slice(4) });
    if (version === 2 && sections.has(line)) { state.section = line; continue; }
    parseMetadataLine(line, state, algorithm);
  }
}

/** Perform an upload-pack negotiation round; no pack-sized response buffer is allocated. */
export async function fetchPack(options) {
  const { transport, url, algorithm = 'sha1', signal, wants, haves = [] } = options;
  checkCancelled(signal);
  checkLimit(wants.length, 100_000, 'Wanted objects');
  checkLimit(haves.length, 100_000, 'Have objects');
  if (!wants.length) throw new GitError('Corrupt', 'Fetch requires at least one wanted object');
  const remote = options.remote ?? await listRemoteRefs(options);
  requireObjectFormat(remote, algorithm);
  let request;
  if (remote.version === 2) {
    if (!remote.capabilities.has('fetch')) throw new GitError('Unsupported', 'Remote does not advertise fetch');
    request = { body: buildV2Command('fetch', fetchArguments(options, remote), remote), sideband: true };
  } else request = buildV1FetchRequest({ ...options, remote, filter: options.filter && validateFilter(options.filter) });
  const response = await gitRequest(transport, {
    url: gitServiceUrl(url, 'git-upload-pack'), method: 'POST', signal, body: request.body,
    headers: { 'Content-Type': 'application/x-git-upload-pack-request', Accept: 'application/x-git-upload-pack-result',
      ...(remote.version === 2 ? { 'Git-Protocol': 'version=2' } : {}) }
  });
  const state = { acknowledgments: [], wantedRefs: [], shallow: [], unshallow: [], ready: false, hasPack: false, section: null };
  return { remote, state, pack: unpackResponse(response.body ?? response, state,
    { ...options, version: remote.version, sideband: request.sideband }) };
}

/** Bounded have rounds, then one final transfer. Earlier rounds must contain acknowledgments only. */
export async function negotiateFetch(options) {
  const haves = options.haves ?? [];
  const batchSize = checkLimit(options.haveBatchSize ?? 256, 4096, 'Have batch size');
  if (!batchSize) throw new GitError('Corrupt', 'Have batch size must be positive');
  let remote = options.remote ?? await listRemoteRefs(options);
  if (remote.version === 2 && !remote.capabilities.get('fetch')?.split(' ').includes('wait-for-done')) {
    return fetchPack({ ...options, remote, haves, done: true });
  }
  const accepted = [];
  for (let end = batchSize; end < haves.length; end += batchSize) {
    const round = await fetchPack({ ...options, remote, haves: haves.slice(0, end), done: false });
    remote = round.remote;
    for await (const bytes of round.pack) {
      if (bytes.length) throw new GitError('Corrupt', 'Server sent an unrequested early pack');
    }
    accepted.push(...round.state.acknowledgments.map(item => item.oid));
    if (round.state.ready || accepted.length) break;
  }
  return fetchPack({ ...options, remote, haves: accepted.length ? [...new Set(accepted)] : haves, done: true });
}
