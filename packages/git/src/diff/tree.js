import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { compilePathspec } from '../ignore.js';
import { formatPatch } from './patch.js';
import { isBinary } from '../eol.js';
import { quoteGitPath, compareGitPaths } from './path.js';

function entryStatus(before, after) {
  if (!before) return 'A';
  if (!after) return 'D';
  if ((before.mode & 0o170000) !== (after.mode & 0o170000)) return 'T';
  return before.oid === after.oid && before.mode === after.mode ? null : 'M';
}

function appendChange(records, path, previous, current) {
  const status = entryStatus(previous, current);
  if (status) {
    records.push({ path, status, oldOid: previous?.oid ?? null, newOid: current?.oid ?? null,
      oldMode: previous?.mode ?? 0, newMode: current?.mode ?? 0, before: previous, after: current });
  }
}

function spans(bytes) {
  const result = new Map();
  let start = 0;
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] !== 10 && index - start < 63 && index !== bytes.length - 1) continue;
    const length = index - start + 1;
    const key = String.fromCharCode(...bytes.subarray(start, index + 1));
    result.set(key, (result.get(key) ?? 0) + length);
    start = index + 1;
  }
  return result;
}

/** Bounded byte-span similarity used for rename/copy candidate scoring. */
export function contentSimilarity(before, after) {
  if (!before.length && !after.length) return 100;
  const left = spans(before);
  const right = spans(after);
  let common = 0;
  for (const [key, count] of left) common += Math.min(count, right.get(key) ?? 0);
  return Math.floor(100 * common / Math.max(before.length, after.length));
}

async function content(repo, entry, options) {
  if (!entry) return new Uint8Array();
  if (entry.data) return entry.data;
  if (entry.mode === 0o160000) return new TextEncoder().encode(`Subproject commit ${entry.oid}\n`);
  return (await repo.odb.read(entry.oid, options)).data;
}

function renameBinding(before, removed, usedSources, usedTargets) {
  return (source, target, score) => {
    const deleted = removed.get(source.path);
    const copied = !deleted || usedSources.has(source.path);
    Object.assign(target, { status: copied ? 'C' : 'R', oldPath: source.path, oldOid: source.oldOid,
      oldMode: source.oldMode, before: before.get(source.path), similarity: score });
    if (deleted && !usedSources.has(source.path)) deleted.omit = true;
    usedSources.add(source.path);
    usedTargets.add(target.path);
  };
}

async function findRenames(repo, records, before, options) {
  const removed = new Map(records.filter(record => record.status === 'D').map(record => [record.path, record]));
  const added = records.filter(record => record.status === 'A');
  const sources = options.copies ? [...before].map(([path, entry]) => ({ path, oldOid: entry.oid, oldMode: entry.mode }))
    : [...removed.values()];
  const usedSources = new Set();
  const usedTargets = new Set();
  const bind = renameBinding(before, removed, usedSources, usedTargets);
  const exact = new Map();
  for (const source of sources) {
    const key = `${source.oldMode}:${source.oldOid}`;
    if (!exact.has(key)) exact.set(key, { entries: [], position: 0 });
    exact.get(key).entries.push(source);
  }
  for (const target of added) {
    const bucket = exact.get(`${target.newMode}:${target.newOid}`);
    if (!bucket) continue;
    const source = bucket.entries[bucket.position] ?? (options.copies ? bucket.entries[0] : null);
    if (source) {
      bind(source, target, 100);
      bucket.position++;
    }
  }
  const remainingSources = sources.filter(source => options.copies || !usedSources.has(source.path));
  const remainingTargets = added.filter(target => !usedTargets.has(target.path));
  checkLimit(remainingSources.length * remainingTargets.length, options.maxRenameComparisons ?? 100000, 'Rename comparisons');
  const cache = new Map();
  const read = async entry => {
    let data = cache.get(entry.oid);
    if (!data) {
      data = await content(repo, entry, options);
      cache.set(entry.oid, data);
    }
    return data;
  };
  const candidates = [];
  for (const source of remainingSources) {
    for (const target of remainingTargets) {
      checkCancelled(options.signal);
      if (source.path === target.path || (source.oldMode & 0o170000) !== (target.newMode & 0o170000)) continue;
      const score = contentSimilarity(await read({ oid: source.oldOid, mode: source.oldMode }), await read(target.after));
      if (score >= (options.renameThreshold ?? 50)) candidates.push({ source, target, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score || compareGitPaths(left.source.path, right.source.path)
    || compareGitPaths(left.target.path, right.target.path));
  for (const { source, target, score } of candidates) {
    if (usedTargets.has(target.path) || (!options.copies && usedSources.has(source.path))) continue;
    bind(source, target, score);
  }
}

/** Diff flattened trees or index/worktree maps; optional patch bodies are generated lazily. */
export async function treeDiff(repo, before, after, options = {}) {
  const matches = compilePathspec(options.pathspec ?? []);
  const records = [];
  for (const [path, previous] of before) {
    checkCancelled(options.signal);
    if (!matches(path)) continue;
    appendChange(records, path, previous, after.get(path));
  }
  for (const [path, current] of after) {
    checkCancelled(options.signal);
    if (!before.has(path) && matches(path)) appendChange(records, path, undefined, current);
  }
  records.sort((left, right) => compareGitPaths(left.path, right.path));
  if (options.renames !== false) await findRenames(repo, records, before, options);
  const result = records.filter(record => !record.omit && (matches(record.path) || (record.oldPath && matches(record.oldPath))));
  if (options.patch) {
    const decoder = new TextDecoder();
    for (const record of result) {
      const oldBytes = await content(repo, record.before, options);
      const newBytes = await content(repo, record.after, options);
      record.binary = isBinary(oldBytes) || isBinary(newBytes);
      record.oldText = record.binary ? null : decoder.decode(oldBytes);
      record.newText = record.binary ? null : decoder.decode(newBytes);
      record.patch = formatPatch(oldBytes, newBytes, { ...options, ...record, oldPath: record.oldPath ?? record.path, newPath: record.path });
    }
  }
  return result;
}

export function formatNameStatus(records, { nul = false, quotePath = false } = {}) {
  const separator = nul ? '\0' : '\t';
  const quote = path => nul ? path : quoteGitPath(path, { quotePath });
  return records.map(record => `${record.status}${record.similarity === undefined ? '' : String(record.similarity).padStart(3, '0')}${separator}`
    + `${record.oldPath ? `${quote(record.oldPath)}${separator}` : ''}${quote(record.path)}${nul ? '\0' : '\n'}`).join('');
}
