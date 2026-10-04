import { indexTree, readHeadTree } from './worktree-tree.js';
import { treeDiff } from './diff/tree.js';
import { compareGitPaths, quoteGitPath } from './diff/path.js';
import { compilePathspec } from './ignore.js';
import { scanWorktree, worktreeTree } from './status-worktree.js';
import { classifyStatusIndex } from './status-index.js';

export { worktreeTree } from './status-worktree.js';

/** Compare HEAD, index and worktree; conflict records preserve all three index stages. */
export async function status(repo, options = {}) {
  await repo.loadIndex(options);
  const indexState = classifyStatusIndex(repo.index);
  const snapshot = await scanWorktree(repo, options, indexState);
  await repo.loadRules(options, snapshot, indexState);
  const head = await readHeadTree(repo, options);
  const index = indexTree(repo.index, { view: true });
  const worktree = await worktreeTree(repo, options, snapshot, true, indexState);
  const staged = await treeDiff(repo, head, index, options);
  const unstaged = await treeDiff(repo, index, worktree, { ...options, renames: options.worktreeRenames ?? false });
  const records = new Map();
  for (const change of staged) records.set(change.path, { path: change.path, oldPath: change.oldPath, similarity: change.similarity,
    kind: change.oldPath ? 'rename' : 'ordinary', indexStatus: change.status, worktreeStatus: '.', staged: true });
  for (const change of unstaged) {
    let record = records.get(change.path);
    const tracked = index.has(change.path) || head.has(change.path) || repo.index.get(change.path)?.intentToAdd;
    if (!tracked) {
      const ignored = repo.ignore.test(change.path);
      if (ignored && !options.ignored) continue;
      record = { path: change.path, kind: ignored ? 'ignored' : 'untracked', indexStatus: '?', worktreeStatus: '?', staged: false };
    } else {
      record ??= { path: change.path, kind: 'ordinary', indexStatus: '.', staged: false };
      record.worktreeStatus = change.status;
    }
    records.set(change.path, record);
  }
  const matches = compilePathspec(options.pathspec ?? []);
  for (const indexed of indexState.special) {
    const path = indexed.path;
    const entry = worktree.get(path);
    if (!matches(path) || !entry?.submoduleState || entry.submodule === 'S...') continue;
    const record = records.get(path) ?? { path, kind: 'ordinary', indexStatus: '.', staged: false };
    record.worktreeStatus = 'M';
    records.set(path, record);
  }
  const conflicts = new Map();
  for (const entry of indexState.unmerged) {
    let stages = conflicts.get(entry.path);
    if (!stages) conflicts.set(entry.path, stages = []);
    stages[entry.stage] = entry;
  }
  for (const [path, stages] of conflicts) {
    const code = stages[1] ? (stages[2] && stages[3] ? 'UU' : stages[2] ? 'UD' : stages[3] ? 'DU' : 'DD')
      : stages[2] && stages[3] ? 'AA' : stages[2] ? 'AU' : 'UA';
    records.set(path, { path, stages, kind: 'unmerged', conflict: true, staged: true, indexStatus: code[0], worktreeStatus: code[1] });
  }
  for (const record of records.values()) {
    record.code = record.kind === 'ignored' ? '!!' : record.indexStatus + record.worktreeStatus;
    record.xy = record.code;
    record.headOid = head.get(record.oldPath ?? record.path)?.oid ?? null;
    record.indexOid = index.get(record.path)?.oid ?? null;
    record.worktreeOid = worktree.get(record.path)?.oid ?? null;
    record.headMode = head.get(record.oldPath ?? record.path)?.mode ?? 0;
    record.indexMode = index.get(record.path)?.mode ?? 0;
    record.worktreeMode = worktree.get(record.path)?.mode ?? 0;
    record.submodule = worktree.get(record.path)?.submodule
      ?? ([record.headMode, record.indexMode, record.worktreeMode].includes(0o160000) ? 'S...' : 'N...');
  }
  return [...records.values()].sort((left, right) => compareGitPaths(left.path, right.path));
}

/** Porcelain-v2 records with optional NUL delimiters for exact machine-readable path handling. */
export function formatPorcelainV2(records, { nul = false, algorithm = 'sha1', quotePath = false } = {}) {
  const zero = '0'.repeat(algorithm === 'sha256' ? 64 : 40);
  const mode = value => value.toString(8).padStart(6, '0');
  const ending = nul ? '\0' : '\n';
  const quote = path => nul ? path : quoteGitPath(path, { quotePath });
  const groups = [[], [], []];
  for (const record of records) groups[record.kind === 'untracked' ? 1 : record.kind === 'ignored' ? 2 : 0].push(record);
  return groups.flat().map(record => {
    if (record.kind === 'untracked') return `? ${quote(record.path)}${ending}`;
    if (record.kind === 'ignored') return `! ${quote(record.path)}${ending}`;
    if (record.kind === 'unmerged') {
      const stages = [1, 2, 3].map(stage => record.stages[stage]);
      return `u ${record.code} ${record.submodule ?? 'N...'} ${stages.map(entry => mode(entry?.mode ?? 0)).join(' ')} ${mode(record.worktreeMode)} `
        + `${stages.map(entry => entry?.oid ?? zero).join(' ')} ${quote(record.path)}${ending}`;
    }
    const base = `${record.code} ${record.submodule ?? 'N...'} ${mode(record.headMode)} ${mode(record.indexMode)} ${mode(record.worktreeMode)} `
      + `${record.headOid ?? zero} ${record.indexOid ?? zero}`;
    if (record.oldPath) return `2 ${base} ${record.indexStatus}${record.similarity} ${quote(record.path)}`
      + `${nul ? '\0' : '\t'}${quote(record.oldPath)}${ending}`;
    return `1 ${base} ${quote(record.path)}${ending}`;
  }).join('');
}
