import { GitError } from '../errors.js';
import { validateWireOid } from './advertisement.js';
import { encodePktLine, flushPacket } from './pktline.js';
import { concatBytes } from './bytes.js';
import { shallowArguments } from '../shallow.js';

/** Negotiate only advertised v0/v1 features and send a stateless complete want/have round. */
export function buildV1FetchRequest({ remote, wants, haves = [], shallow = [], depth, since, exclude = [], filter,
  unshallow = false, relative = false, done = true, onProgress, algorithm = 'sha1' }) {
  const accepted = ['multi_ack_detailed', 'thin-pack', 'ofs-delta', 'side-band-64k', 'include-tag'];
  if (!onProgress) accepted.push('no-progress');
  if (filter) {
    if (!remote.capabilities.has('filter')) throw new GitError('Unsupported', 'Remote does not support partial clone filters');
    accepted.push('filter');
  }
  if (remote.capabilities.has('object-format')) accepted.push(`object-format=${algorithm}`);
  const capabilities = accepted.filter(name => remote.capabilities.has(name.split('=')[0]));
  const packets = [];
  wants.forEach((oid, index) => {
    validateWireOid(oid, algorithm);
    packets.push(encodePktLine(`want ${oid}${index === 0 && capabilities.length ? ` ${capabilities.join(' ')}` : ''}\n`));
  });
  for (const line of shallowArguments({ shallow, depth, since, exclude, unshallow, relative, algorithm })) {
    if (!remote.capabilities.has('shallow')) throw new GitError('Unsupported', 'Remote does not support shallow fetch');
    if (line === 'deepen-relative' && !remote.capabilities.has('deepen-relative')) {
      throw new GitError('Unsupported', 'Remote does not support relative deepening');
    }
    packets.push(encodePktLine(`${line}\n`));
  }
  if (filter) packets.push(encodePktLine(`filter ${filter}\n`));
  packets.push(flushPacket());
  for (const oid of haves) packets.push(encodePktLine(`have ${validateWireOid(oid, algorithm)}\n`));
  packets.push(done ? encodePktLine('done\n') : flushPacket());
  return { body: concatBytes(packets, 16 * 1024 * 1024), sideband: capabilities.includes('side-band-64k') };
}
