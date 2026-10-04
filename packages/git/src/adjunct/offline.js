import { readZip } from '@sharpforge/archive';
import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { validateCheckoutPath, validateCheckoutPaths } from '../path-safety.js';
import { asBytes } from '../hash/bytes.js';
import { collectReachable } from '../remote-graph.js';
import { writePack } from '../pack/writer.js';
import { parseShallow } from '../shallow.js';
import { concatBytes, encodeText } from '../protocol/bytes.js';
import { localObjectDatabase } from './promisor.js';

function sameBytes(left, right) {
  return left?.length === right.length && left.every((byte, index) => byte === right[index]);
}

function zipModes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) end--;
  let cursor = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  const modes = [];
  for (let index = 0; index < count; index++) {
    const unix = view.getUint16(cursor + 4, true) >>> 8 === 3;
    modes.push(unix && (view.getUint32(cursor + 38, true) >>> 16 & 0o111) ? 0o100755 : 0o100644);
    cursor += 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
  return modes;
}

/** Import validated ZIP files into the worktree with complete path/overwrite checks before any writes. */
export async function importWorktreeZip(repo, bytes, options = {}) {
  bytes = asBytes(bytes);
  let entries;
  try { entries = readZip(bytes, options); }
  catch (error) { throw new GitError('Corrupt', 'ZIP import failed validation', { reason: error.message }); }
  const modes = zipModes(bytes);
  const writes = [];
  let snapshotBytes = 0;
  for (let index = 0; index < entries.length; index++) {
    checkCancelled(options.signal);
    const entry = entries[index];
    const path = validateCheckoutPath(options.prefix ? `${validateCheckoutPath(options.prefix)}/${entry.path}` : entry.path);
    if (entry.directory) continue;
    if (repo.worktree.supportedModes && !repo.worktree.supportedModes.includes(modes[index])) {
      throw new GitError('Unsupported', 'The worktree cannot preserve an imported executable mode', { path, mode: modes[index] });
    }
    const current = await repo.worktree.read(path, options);
    if (current && sameBytes(current.data, entry.bytes) && current.mode === modes[index]) continue;
    if (repo.dirtyBuffers && await repo.dirtyBuffers(path)) throw new GitError('Conflict', 'ZIP import would overwrite an editor buffer', { path });
    if (current && !options.overwrite) throw new GitError('Conflict', 'ZIP import would overwrite an existing file', { path });
    snapshotBytes += current?.data.length ?? 0;
    checkLimit(snapshotBytes, options.maxSnapshotBytes ?? 128 * 1024 * 1024, 'ZIP rollback data');
    writes.push({ path, bytes: entry.bytes, mode: modes[index] });
  }
  const paths = new Set([...await repo.worktree.list(options), ...writes.map(entry => entry.path)]);
  validateCheckoutPaths(paths, { caseSensitive: repo.worktree.caseSensitive !== false });
  const snapshot = await repo.snapshot(writes.map(entry => entry.path), options);
  try {
    for (const entry of writes) await repo.worktree.write(entry.path, entry.bytes, { ...options, mode: entry.mode });
    if (options.stage && writes.length) await repo.add(writes.map(entry => `:(literal,top)${entry.path}`), options);
  } catch (error) { await repo.restoreSnapshot(snapshot); throw error; }
  return { files: writes.map(entry => ({ path: entry.path, mode: entry.mode, size: entry.bytes.length })), staged: !!options.stage };
}

/** Export a full self-contained v2/v3 bundle. Incomplete shallow or promisor closures fail explicitly. */
export async function exportRepositoryBundle(repo, options = {}) {
  const odb = localObjectDatabase(repo.odb);
  const shallow = parseShallow(await repo.store.get('shallow', options), { algorithm: repo.algorithm });
  if (shallow.size) throw new GitError('Unsupported', 'Full bundle export requires complete shallow history');
  const references = await repo.refs.list('refs/', options);
  const wanted = options.refs ? new Set(options.refs) : null;
  const refs = references.filter(ref => ref.oid && (!wanted || wanted.has(ref.name))).map(({ name, oid }) => ({ name, oid }));
  if (wanted && refs.length !== wanted.size) throw new GitError('NotFound', 'A requested bundle reference is missing');
  const head = await repo.refs.read('HEAD', options);
  if (head && (!wanted || refs.some(ref => ref.oid === head))) refs.push({ name: 'HEAD', oid: head });
  if (!refs.length) throw new GitError('NotFound', 'Bundle export requires a reference');
  checkLimit(refs.length, options.maxRefs ?? 100000, 'Bundle reference count');
  const reachable = await collectReachable({ ...options, odb, algorithm: repo.algorithm, tips: refs.map(ref => ref.oid) });
  const ids = [...reachable].sort();
  const objects = (async function* () {
    for (const oid of ids) {
      const object = await odb.read(oid, options);
      options.assertSafeObject?.(object.data);
      yield object;
    }
  })();
  const maximum = options.maxBundleBytes ?? 64 * 1024 * 1024;
  const pack = await writePack(objects, { ...options, algorithm: repo.algorithm, count: ids.length, maxPackBytes: maximum });
  const signature = repo.algorithm === 'sha1' ? '# v2 git bundle\n' : '# v3 git bundle\n@object-format=sha256\n';
  const header = encodeText(`${signature}${refs.map(ref => `${ref.oid} ${ref.name}\n`).join('')}\n`);
  return { bytes: concatBytes([header, pack.pack], maximum), refs, objects: ids.length, algorithm: repo.algorithm };
}
