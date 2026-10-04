import { GitError, checkLimit } from './errors.js';
import { diffLines } from './diff/lines.js';
import { treeDiff } from './diff/tree.js';
import { hashObject } from './hash.js';
import { validateCheckoutPath } from './path-safety.js';

const decoder = new TextDecoder('utf-8', { fatal: true });

/** Immutable comparison data stays in the worker; the UI receives only bounded row pages. */
export class GitViewData {
  constructor({ maxBytes = 256 * 1024 * 1024, maxEntries = 4 } = {}) {
    this.maxBytes = checkLimit(maxBytes, 1024 * 1024 * 1024, 'Git comparison cache maximum bytes');
    this.maxEntries = checkLimit(maxEntries, 64, 'Git comparison cache maximum entries');
    if (!maxBytes || !maxEntries) throw new GitError('Limit', 'Git comparison cache capacity must be positive');
    this.entries = new Map();
    this.bytes = 0;
    this.sequence = 0;
  }

  remember(value) {
    const bytes = (value.before.data.length + value.after.data.length) * 3 + value.lines.length * 80;
    checkLimit(bytes, this.maxBytes, 'Git comparison cache bytes');
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) this.release(this.entries.keys().next().value);
    const key = `comparison-${++this.sequence}`;
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    return key;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) throw new GitError('NotFound', 'Comparison snapshot has expired; refresh the view');
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  release(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  dispose() {
    this.entries.clear();
    this.bytes = 0;
    this.workingBlame = null;
  }
}

export function viewSession(repo) {
  repo.views ??= new GitViewData();
  return repo.views;
}

/** Preserve existence, type and arbitrary bytes; non-UTF-8 content is never decoded lossily. */
export async function fileVersion(repo, entry, options = {}) {
  if (!entry) return { exists: false, oid: null, mode: 0, size: 0, data: new Uint8Array(), text: '', binary: false };
  let data = entry.data;
  if (!data && entry.mode === 0o160000) data = new TextEncoder().encode(`Subproject commit ${entry.oid}\n`);
  if (!data) {
    const object = await repo.odb.read(entry.oid, options);
    if (object.type !== 'blob') throw new GitError('Corrupt', 'A file version must reference a blob');
    data = object.data;
  }
  let text = null;
  if (!data.subarray(0, 8000).includes(0)) {
    try { text = decoder.decode(data); } catch { /* Non-UTF-8 content is shown as bytes, never replacement characters. */ }
  }
  return { exists: true, oid: entry.oid ?? null, mode: entry.mode, size: data.length, data, text, binary: text === null };
}

export function versionSummary(version) {
  return { exists: version.exists, oid: version.oid, mode: version.mode, size: version.size, binary: version.binary };
}

export async function commitComparison(repo, params, context) {
  const oid = await repo.revParse(`${params.commit ?? params.revision}^{commit}`, context);
  const traversal = await repo.graph.context(context);
  const commit = repo.graph.project(await repo.readCommit(oid, context), traversal);
  const parentIndex = params.parentIndex ?? 0;
  checkLimit(parentIndex, Math.max(0, commit.parents.length - 1), 'Commit comparison parent');
  const parent = commit.parents[parentIndex] ?? null;
  const before = parent ? await repo.readTree(parent, context) : new Map();
  const after = await repo.readTree(oid, context);
  const records = await treeDiff(repo, before, after, { ...context, ...params, pathspec: [], patch: false });
  return { commit, parent, before, after, records };
}

export async function prepareComparison(repo, params, context) {
  validateCheckoutPath(params.path);
  let before;
  let after;
  let oldPath = params.path;
  let revision = null;
  let parent = null;
  let status = null;
  if (params.commit || params.revision) {
    const compared = await commitComparison(repo, params, context);
    const record = compared.records.find(item => item.path === params.path || item.oldPath === params.path);
    oldPath = record?.oldPath ?? params.path;
    before = await fileVersion(repo, compared.before.get(oldPath), context);
    after = await fileVersion(repo, compared.after.get(record?.path ?? params.path), context);
    revision = compared.commit.oid;
    parent = compared.parent;
    status = record?.status ?? null;
  } else {
    await repo.loadIndex(context);
    await repo.loadRules(context);
    if (repo.index.unmerged.some(entry => entry.path === params.path)) throw new GitError('Conflict', 'Open this path in Merge Conflicts');
    const tree = await repo.readTree('HEAD', context);
    const base = tree.get(params.path);
    const index = repo.index.get(params.path);
    before = await fileVersion(repo, params.staged ? base : index, context);
    if (params.staged) after = await fileVersion(repo, index, context);
    else {
      const file = await repo.worktree.read(params.path, context);
      const data = file ? await repo.clean(params.path, file.data, context) : null;
      after = await fileVersion(repo, file ? { ...file, data, oid: await hashObject('blob', data, { algorithm: repo.algorithm }) } : null, context);
    }
  }
  const binary = before.binary || after.binary;
  const lines = binary ? [] : diffLines(before.text, after.text, { ...params, ...context });
  const hunks = comparisonHunks(lines);
  return { path: params.path, oldPath, revision, parent, before, after, binary, lines, staged: !!params.staged,
    historical: !!revision, status, hunks };
}

/** Store each hunk once and attach its controls to its first changed row. */
export function comparisonHunks(lines, context = 3) {
  const hunks = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].type === 'equal') continue;
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length, index + context + 1);
    if (hunks.length && start <= hunks.at(-1).end) hunks.at(-1).end = end;
    else hunks.push({ start, end, anchor: index });
  }
  for (const hunk of hunks) lines[hunk.anchor].hunk = hunk;
  return hunks;
}

/** Read-only editor models are bounded excerpts of an immutable worker snapshot. */
export function comparisonDocuments(value, params) {
  if (value.binary) throw new GitError('Unsupported', 'Binary comparison has no text document');
  const start = checkLimit(params.start ?? 0, value.lines.length, 'Comparison source start');
  const count = checkLimit(params.count ?? 256, 1000, 'Comparison source count');
  const full = value.before.size + value.after.size <= 2 * 1024 * 1024;
  const excerpt = value.lines.slice(start, start + count);
  const source = (version, side) => {
    const lines = excerpt.filter(line => line.type !== (side === 'before' ? 'insert' : 'delete'));
    const text = full ? version.text : lines.map(line => line.line).join('');
    checkLimit(text.length, 2 * 1024 * 1024, 'Read-only source context text');
    return { ...versionSummary(version), text, startLine: full ? 1 : lines[0]?.[side === 'before' ? 'oldLine' : 'newLine'] ?? 1,
      excerpt: !full, path: side === 'before' ? value.oldPath : value.path };
  };
  return { before: source(value.before, 'before'), after: source(value.after, 'after') };
}

export function comparisonPage(value, key, params) {
  const start = checkLimit(params.start ?? 0, value.lines.length, 'Comparison page start');
  const count = checkLimit(params.count ?? 256, 1000, 'Comparison page count');
  return { cacheKey: key, path: value.path, oldPath: value.oldPath, commit: value.revision, parent: value.parent,
    historical: value.historical, staged: value.staged, binary: value.binary, status: value.status,
    before: versionSummary(value.before), after: versionSummary(value.after), total: value.lines.length, start,
    lines: value.lines.slice(start, start + count) };
}
