import { writeZip } from '@sharpforge/archive';
import { GitError, checkCancelled, checkLimit } from './errors.js';
import { decodeCommit, decodeTree, decodeTag } from './objects.js';
import { AttributesMatcher } from './attributes.js';
import { validateCheckoutPath } from './path-safety.js';
import { validateRefName } from './refs/names.js';
import { validateWireOid } from './protocol/advertisement.js';
import { byteChunks, concatBytes, decodeText, encodeText } from './protocol/bytes.js';
import { readPack } from './pack/reader.js';
import { validateFilter } from './promisor.js';
import { verifyFetchedClosure } from './remote-graph.js';
import { parseShallow } from './shallow.js';

async function treeOf(odb, oid, options) {
  const visited = new Set();
  for (let depth = 0; depth < 32; depth++) {
    if (visited.has(oid)) throw new GitError('Corrupt', 'Archive target has a tag cycle');
    visited.add(oid);
    const object = await odb.read(oid, options);
    if (object.type === 'tree') return oid;
    if (object.type === 'commit') return decodeCommit(object.data, options).tree;
    if (object.type === 'tag') { oid = decodeTag(object.data, options).object; continue; }
    throw new GitError('Unsupported', 'Archive target must resolve to a tree or commit');
  }
  throw new GitError('Limit', 'Archive tag depth exceeded');
}

async function archiveEntries({ odb, oid, algorithm = 'sha1', signal, maxEntries = 20_000, maxDepth = 48, attributes }) {
  const matcher = attributes ?? new AttributesMatcher();
  const root = await treeOf(odb, oid, { algorithm, signal });
  const queue = [{ oid: root, base: '', depth: 0 }];
  const entries = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    checkCancelled(signal);
    const item = queue[cursor];
    checkLimit(item.depth, maxDepth, 'Archive tree depth');
    const tree = await odb.read(item.oid, { signal });
    if (tree.type !== 'tree') throw new GitError('Corrupt', 'Archive subtree points to a non-tree object');
    for (const entry of decodeTree(tree.data, { algorithm })) {
      if (typeof entry.name !== 'string') throw new GitError('Unsupported', 'ZIP export requires UTF-8 tree paths');
      const path = validateCheckoutPath(`${item.base}${entry.name}`);
      const mode = typeof entry.mode === 'string' ? Number.parseInt(entry.mode, 8) : entry.mode;
      checkLimit(entries.length + 1, maxEntries, 'Archive entries');
      entries.push({ path, oid: entry.oid, mode, directory: mode === 0o40000 || mode === 0o160000 });
      if (mode === 0o40000) queue.push({ oid: entry.oid, base: `${path}/`, depth: item.depth + 1 });
      if (entry.name === '.gitattributes' && mode === 0o100644) {
        const object = await odb.read(entry.oid, { signal });
        matcher.add(decodeText(object.data), { base: item.base.replace(/\/$/, ''), source: path, priority: item.depth });
      }
    }
  }
  const excludedDirectories = new Set();
  const included = [];
  for (const entry of entries) {
    const parts = entry.path.split('/');
    parts.pop();
    let inherited = false;
    while (parts.length) { if (excludedDirectories.has(parts.join('/'))) inherited = true; parts.pop(); }
    if (inherited || matcher.get(entry.path)['export-ignore'] === true) {
      if (entry.directory) excludedDirectories.add(entry.path);
    } else included.push(entry);
  }
  return included;
}

/** Preserve Unix executable/symlink modes in the ZIP central directory produced by the shared archive writer. */
function applyZipModes(bytes, modes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  let cursor = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  for (let index = 0; index < count; index++) {
    const length = view.getUint16(cursor + 28, true);
    const path = decodeText(bytes.subarray(cursor + 46, cursor + 46 + length)).replace(/\/$/, '');
    const mode = modes.get(path);
    if (mode !== undefined) view.setUint32(cursor + 38, ((mode << 16) | (mode === 0o40755 ? 16 : 0)) >>> 0, true);
    cursor += 46 + length + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
}

/** Export a deterministic ZIP of a commit/tree, respecting in-tree export-ignore without executing filters. */
export async function exportTreeZip(options) {
  const { odb, signal, prefix = '', maxTotalBytes = 128 * 1024 * 1024 } = options;
  const rootPrefix = prefix ? `${validateCheckoutPath(prefix.replace(/\/$/, ''))}/` : '';
  const entries = await archiveEntries(options);
  const files = [];
  const modes = new Map();
  let total = 0;
  for (const entry of entries) {
    checkCancelled(signal);
    const path = `${rootPrefix}${entry.path}`;
    if (entry.directory) {
      files.push({ path, directory: true });
      modes.set(path, 0o40755);
      continue;
    }
    const object = await odb.read(entry.oid, { signal });
    if (object.type !== 'blob') throw new GitError('Corrupt', 'Archive file points to a non-blob');
    total = checkLimit(total + object.data.length, maxTotalBytes, 'Archive file bytes');
    files.push({ path, bytes: object.data });
    modes.set(path, entry.mode);
  }
  const exported = options.sanitizeFiles ? await options.sanitizeFiles(files.map(file => ({
    ...file, bytes: file.bytes ?? new Uint8Array()
  }))) : files;
  if (!Array.isArray(exported) || exported.length !== files.length) throw new GitError('Corrupt', 'ZIP sanitization changed the entry count');
  const exportedModes = new Map();
  for (let index = 0; index < exported.length; index++) {
    const file = exported[index];
    if (!file || !!file.directory !== !!files[index].directory) throw new GitError('Corrupt', 'ZIP sanitization changed an entry kind');
    exportedModes.set(file.path, modes.get(files[index].path));
  }
  let bytes;
  try { bytes = writeZip(exported, options); }
  catch (error) { throw new GitError('Unsafe', 'Archive entries cannot be represented safely', { reason: error.message }); }
  applyZipModes(bytes, exportedModes);
  return { bytes, entries: exported.map(file => ({ path: file.path, directory: !!file.directory, size: file.bytes?.length ?? 0 })) };
}

function parseBundleHeader(bytes, { algorithm, maxRefs = 100_000 } = {}) {
  const lines = decodeText(bytes).split('\n');
  const signature = lines.shift();
  const version = signature === '# v2 git bundle' ? 2 : signature === '# v3 git bundle' ? 3 : null;
  if (!version) throw new GitError('Corrupt', 'Invalid Git bundle signature');
  const capabilities = new Map();
  const refs = [];
  const prerequisites = [];
  let refsStarted = false;
  let format = version === 2 ? 'sha1' : null;
  for (const line of lines.filter(Boolean)) {
    if (line.startsWith('@')) {
      if (version !== 3 || refsStarted) throw new GitError('Corrupt', 'Bundle capability appears outside the header');
      const separator = line.indexOf('=');
      const name = line.slice(1, separator < 0 ? undefined : separator);
      const value = separator < 0 ? '' : line.slice(separator + 1);
      if (capabilities.has(name)) throw new GitError('Corrupt', 'Duplicate bundle capability');
      if (!['object-format', 'filter'].includes(name)) throw new GitError('Unsupported', 'Unknown required bundle capability', { capability: name });
      if (name === 'object-format') format = value;
      if (name === 'filter') validateFilter(value);
      capabilities.set(name, value);
      continue;
    }
    refsStarted = true;
    format ??= 'sha1';
    const separator = line.indexOf(' ');
    if (separator < 0) throw new GitError('Corrupt', 'Malformed bundle reference');
    const prerequisite = line.startsWith('-');
    const oid = validateWireOid(line.slice(prerequisite ? 1 : 0, separator), format);
    const name = line.slice(separator + 1);
    if (prerequisite) prerequisites.push({ oid, comment: name });
    else {
      if (name !== 'HEAD') validateRefName(name);
      refs.push({ name, oid });
    }
    checkLimit(refs.length + prerequisites.length, maxRefs, 'Bundle refs and prerequisites');
  }
  format ??= 'sha1';
  if (algorithm && algorithm !== format) {
    throw new GitError('Unsupported', 'Bundle object format differs from destination', { expected: algorithm, actual: format });
  }
  if (new Set(refs.map(ref => ref.name)).size !== refs.length) throw new GitError('Corrupt', 'Duplicate bundle reference');
  return { version, algorithm: format, capabilities, refs, prerequisites };
}

/** Parse only the small textual header; the pack remains an async byte stream. */
export async function readBundle(source, options = {}) {
  const iterator = byteChunks(source, options)[Symbol.asyncIterator]();
  const chunks = [];
  let size = 0;
  let previous = -1;
  while (true) {
    const next = await iterator.next();
    if (next.done) throw new GitError('Corrupt', 'Bundle has no pack boundary');
    const bytes = next.value;
    for (let index = 0; index < bytes.length; index++) {
      if (previous === 10 && bytes[index] === 10) {
        chunks.push(bytes.subarray(0, index));
        const headerBytes = concatBytes(chunks, options.maxHeaderBytes ?? 1024 * 1024);
        const header = parseBundleHeader(headerBytes, options);
        const pack = (async function* () {
          try {
            if (index + 1 < bytes.length) yield bytes.subarray(index + 1);
            while (true) { const remaining = await iterator.next(); if (remaining.done) break; yield remaining.value; }
          } finally { await iterator.return?.(); }
        })();
        return { ...header, pack };
      }
      previous = bytes[index];
    }
    size = checkLimit(size + bytes.length, options.maxHeaderBytes ?? 1024 * 1024, 'Bundle header');
    chunks.push(bytes);
  }
}

/** Import v2/v3 bundles offline, checking prerequisites and the pack before moving any refs. */
export async function importBundle(source, options) {
  const { odb, refs, signal, updateRefs = true } = options;
  const bundle = await readBundle(source, options);
  for (const prerequisite of bundle.prerequisites) {
    if (!await odb.has(prerequisite.oid, { signal })) throw new GitError('NotFound', 'Bundle prerequisite is missing', { oid: prerequisite.oid });
  }
  const pack = await readPack(bundle.pack, { ...options, algorithm: bundle.algorithm, staging: options.staging ?? odb.store });
  for (const ref of bundle.refs) if (!await odb.has(ref.oid, { signal })) throw new GitError('Corrupt', 'Bundle reference points to a missing object');
  await verifyFetchedClosure({ ...options, algorithm: bundle.algorithm, tips: bundle.refs.map(ref => ref.oid),
    filter: bundle.capabilities.get('filter'), shallow: parseShallow(await odb.store?.get('shallow'), { algorithm: bundle.algorithm }) });
  const updates = [];
  if (updateRefs) {
    for (const ref of bundle.refs) if (ref.name !== 'HEAD') {
      const expected = await refs.read(ref.name, { signal });
      if (expected && expected !== ref.oid && !options.force) {
        throw new GitError('Conflict', 'Bundle import would overwrite an existing ref', { ref: ref.name });
      }
      updates.push({ name: ref.name, oid: ref.oid, expected, message: 'bundle import' });
    }
    await refs.transaction(updates, { signal });
    const head = bundle.refs.find(ref => ref.name === 'HEAD');
    if (head && !await refs.read('HEAD', { signal })) {
      const branch = bundle.refs.find(ref => ref.name.startsWith('refs/heads/') && ref.oid === head.oid);
      if (branch) await refs.setSymbolic('HEAD', branch.name, { signal });
      else await refs.update('HEAD', head.oid, { deref: false, signal, message: 'bundle HEAD' });
    }
  }
  if (bundle.capabilities.has('filter') && odb.store) {
    await odb.store.set('sharpforge/bundle-filter', encodeText(bundle.capabilities.get('filter')), { signal });
  }
  return { version: bundle.version, algorithm: bundle.algorithm, refs: bundle.refs, prerequisites: bundle.prerequisites, pack };
}
