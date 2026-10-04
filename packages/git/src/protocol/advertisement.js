import { GitError } from '../errors.js';
import { getObjectFormat } from '../object-format.js';
import { decodePktLines, PacketKind } from './pktline.js';
import { decodeText, protocolField } from './bytes.js';

export function validateWireOid(oid, algorithm = 'sha1') {
  const format = getObjectFormat(algorithm);
  if (typeof oid !== 'string' || oid.length !== format.oidLength || !/^[0-9a-f]+$/.test(oid)) {
    throw new GitError('Corrupt', 'Invalid protocol object ID', { algorithm });
  }
  return oid;
}

export function parseCapabilities(line, separator = ' ') {
  const capabilities = new Map();
  for (const item of line.split(separator).filter(Boolean)) {
    const equals = item.indexOf('=');
    const name = equals < 0 ? item : item.slice(0, equals);
    capabilities.set(name, equals < 0 ? '' : item.slice(equals + 1));
  }
  return capabilities;
}

/** Parse smart HTTP v0/v1/v2 advertisements without interpreting capability names as commands. */
export async function parseAdvertisement(source, { service = 'git-upload-pack', algorithm = 'sha1', signal } = {}) {
  const result = { version: 0, capabilities: new Map(), refs: [], algorithm };
  let firstRef = true;
  for await (const packet of decodePktLines(source, { signal })) {
    if (packet.kind !== PacketKind.Data) continue;
    const line = decodeText(packet.data).replace(/\n$/, '');
    if (line.startsWith('# service=')) {
      if (line !== `# service=${service}`) throw new GitError('Corrupt', 'Unexpected Git service advertisement');
      continue;
    }
    if (line === 'version 2' || line === 'version 1') { result.version = Number(line.at(-1)); continue; }
    if (line.startsWith('ERR ')) throw new GitError('Network', 'Remote Git advertisement failed', { remoteMessage: line.slice(4) });
    if (result.version === 2) {
      const capabilities = parseCapabilities(line, '\n');
      for (const [key, value] of capabilities) result.capabilities.set(key, value);
      continue;
    }
    const nul = line.indexOf('\0');
    const refLine = nul < 0 ? line : line.slice(0, nul);
    if (nul >= 0) {
      if (!firstRef) throw new GitError('Corrupt', 'Capabilities appeared after the first advertised ref');
      result.capabilities = parseCapabilities(line.slice(nul + 1));
    }
    const formatName = result.capabilities.get('object-format') || algorithm;
    const split = refLine.indexOf(' ');
    if (split < 0) throw new GitError('Corrupt', 'Malformed advertised reference');
    const oid = validateWireOid(refLine.slice(0, split), formatName);
    const name = protocolField(refLine.slice(split + 1), 'Reference name');
    if (name !== 'capabilities^{}') result.refs.push({ name, oid });
    firstRef = false;
  }
  result.algorithm = result.capabilities.get('object-format') || 'sha1';
  getObjectFormat(result.algorithm);
  const symref = result.capabilities.get('symref');
  if (symref) {
    const separator = symref.indexOf(':');
    const ref = result.refs.find(item => item.name === symref.slice(0, separator));
    if (ref) ref.symref = symref.slice(separator + 1);
  }
  return result;
}

/** Require format agreement before interpreting pack trailers or writing references. */
export function requireObjectFormat(remote, algorithm) {
  if (remote.algorithm !== algorithm) {
    throw new GitError('Unsupported', 'Remote and local object formats differ', { local: algorithm, remote: remote.algorithm });
  }
}
