import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { hashObject } from '../hash.js';
import { parseObject, decodeTree, decodeCommit, decodeTag } from '../objects.js';
import { inflateZlib } from '../zlib.js';
import { IntegrityCategory as Category } from './report.js';

function treeLinks(data, algorithm, options) {
  return decodeTree(data, { ...options, algorithm }).map(entry => {
    if (entry.name?.toLowerCase() === '.git') throw new GitError('Corrupt', 'Tree contains a .git entry');
    return {
      oid: entry.oid, type: entry.mode === 0o40000 ? 'tree' : entry.mode === 0o160000 ? 'commit' : 'blob',
      path: entry.name, external: entry.mode === 0o160000
    };
  });
}

function commitLinks(data, algorithm, options) {
  const commit = decodeCommit(data, { ...options, algorithm });
  if (commit.headers[0].key !== 'tree') throw new GitError('Corrupt', 'Commit does not begin with its tree header');
  return [{ oid: commit.tree, type: 'tree' }, ...commit.parents.map(oid => ({ oid, type: 'commit' }))];
}

function tagLinks(data, algorithm, options) {
  const tag = decodeTag(data, { ...options, algorithm });
  return [{ oid: tag.object, type: tag.type }];
}

const decoders = Object.freeze({
  blob: () => [], tree: treeLinks, commit: commitLinks, tag: tagLinks
});
const invalidCategory = Object.freeze({ tree: Category.BadTree, commit: Category.BadCommit, tag: Category.BadTag });

async function readObject(repository, oid, options) {
  // Reading the raw loose envelope allows fsck to classify a malformed tree precisely,
  // even though normal ODB reads deliberately reject its semantics before returning it.
  if (repository.odb.store?.get) {
    const key = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
    const compressed = await repository.odb.store.get(key, options);
    if (compressed !== undefined) {
      const raw = await inflateZlib(compressed, { ...options, maxOutputBytes: options.maxObjectBytes ?? 64 * 1024 * 1024 });
      return { oid, ...parseObject(raw, options) };
    }
  }
  return repository.odb.readLocal ? repository.odb.readLocal(oid, options) : repository.odb.read(oid, options);
}

/** Decode every object once; retain only typed edges, never the complete repository's blob contents. */
export async function scanIntegrityObjects(repository, initialIds, report, options) {
  const nodes = new Map();
  const queued = new Set(initialIds);
  const pending = [...queued];
  const maximum = options.maxObjects ?? 1_000_000;
  let bytes = 0;
  let edges = 0;
  let externalLinks = 0;
  for (let index = 0; index < pending.length; index++) {
    checkCancelled(options.signal);
    checkLimit(pending.length, maximum, 'Integrity object count');
    const oid = pending[index];
    let object;
    try {
      object = await readObject(repository, oid, options);
    } catch (error) {
      if (error instanceof GitError && error.code === 'NotFound') {
        report.add(Category.MissingObject, 'Referenced object is missing', { oid });
      } else report.capture(error, Category.InvalidObject, { oid });
      nodes.set(oid, null);
      continue;
    }
    bytes += object.data.length;
    checkLimit(bytes, options.maxBytes ?? 8 * 1024 * 1024 * 1024, 'Integrity expanded bytes');
    try {
      const actual = await hashObject(object.type, object.data, { ...options, algorithm: repository.algorithm });
      if (actual !== oid) report.add(Category.HashMismatch, 'Object content does not match its address', { oid, actual });
    } catch (error) { report.capture(error, Category.HashMismatch, { oid }); }
    let links = [];
    try {
      const decode = decoders[object.type];
      if (!decode) throw new GitError('Corrupt', 'Unknown stored object type');
      links = decode(object.data, repository.algorithm, options);
      if (object.type === 'commit' && options.shallow?.has(oid)) links = links.filter(link => link.type !== 'commit');
    } catch (error) {
      report.capture(error, invalidCategory[object.type] ?? Category.InvalidObject, { oid, type: object.type });
    }
    edges += links.length;
    checkLimit(edges, options.maxEdges ?? 4_000_000, 'Integrity graph edges');
    nodes.set(oid, { oid, type: object.type, size: object.data.length, links });
    for (const link of links) {
      if (link.external) { externalLinks++; continue; }
      if (!queued.has(link.oid)) {
        queued.add(link.oid);
        pending.push(link.oid);
      }
    }
    options.onProgress?.({ phase: 'fsck', completed: index + 1, total: pending.length, bytes, errors: report.errors });
  }
  return { nodes, bytes, edges, externalLinks };
}
