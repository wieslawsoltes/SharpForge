import { GitError, checkCancelled, checkLimit } from './errors.js';
import { hashObject } from './hash.js';
import { diffLines } from './diff/lines.js';
import { fileVersion, viewSession } from './view-data.js';

function lineCount(text, signal) {
  let total = text.length && !text.endsWith('\n') ? 1 : 0;
  for (let index = 0; index < text.length; index++) {
    if (index % 65536 === 0) checkCancelled(signal);
    if (text[index] === '\n') total++;
  }
  return total;
}

function pageRange(params, total) {
  const start = checkLimit(params.start ?? 0, total, 'Blame page start');
  const count = checkLimit(params.count ?? 256, 1000, 'Blame page count');
  return { start, end: Math.min(total, start + count) };
}

async function workingMapping(repo, path, oid, before, params, context) {
  await repo.loadRules(context);
  const file = await repo.worktree.read(path, context);
  if (!file) throw new GitError('NotFound', 'Blame path has been deleted from the working tree');
  const data = await repo.clean(path, file.data, context);
  const workingOid = await hashObject('blob', data, { algorithm: repo.algorithm });
  if (params.workingOid && params.workingOid !== workingOid) {
    throw new GitError('Conflict', 'Working file changed while paging blame; refresh the comparison');
  }
  const after = await fileVersion(repo, { ...file, oid: workingOid, data }, context);
  if (after.binary) throw new GitError('Unsupported', 'Blame requires a text file');
  const session = viewSession(repo);
  const key = `${path}\0${oid}\0${workingOid}`;
  if (session.workingBlame?.key === key) return session.workingBlame.value;
  const lines = [];
  for (const change of diffLines(before.text, after.text, { ...params, ...context })) {
    if (change.type === 'delete') continue;
    lines.push({ ...change, committed: change.type === 'equal' });
  }
  const value = { lines, workingOid };
  // One bounded mapping is retained independently from immutable diff snapshots.
  const weight = lines.length * 64 + data.length * 2;
  if (weight <= 32 * 1024 * 1024) session.workingBlame = { key, value };
  else session.workingBlame = null;
  return value;
}

/** Blame pages freeze HEAD and optionally project attribution through the current editor worktree. */
export async function blamePage(repo, params, context) {
  const oid = await repo.revParse(`${params.revision ?? 'HEAD'}^{commit}`, context);
  const entry = (await repo.readTree(oid, context)).get(params.path);
  if (!entry && !params.workingTree) throw new GitError('NotFound', 'Blame path does not exist in this revision');
  const before = await fileVersion(repo, entry, context);
  if (before.binary) throw new GitError('Unsupported', 'Blame requires a text file');
  if (!params.workingTree) {
    const total = lineCount(before.text, context.signal);
    checkLimit(total, params.maxLines ?? 1000000, 'Blame line count');
    const { start, end } = pageRange(params, total);
    const lines = end > start ? await repo.blame(params.path, { ...params, ...context, revision: oid, startLine: start + 1,
      endLine: end, maxLines: params.maxLines ?? 1000000, incremental: false }) : [];
    return { path: params.path, revision: oid, total, start, lines };
  }
  const mapping = await workingMapping(repo, params.path, oid, before, params, context);
  checkLimit(mapping.lines.length, params.maxLines ?? 1000000, 'Blame line count');
  const { start, end } = pageRange(params, mapping.lines.length);
  const selected = mapping.lines.slice(start, end);
  const committed = selected.filter(line => line.committed);
  const attributed = committed.length ? await repo.blame(params.path, { ...params, ...context, revision: oid,
    startLine: committed[0].oldLine, endLine: committed.at(-1).oldLine, maxLines: params.maxLines ?? 1000000, incremental: false }) : [];
  const byLine = new Map(attributed.map(line => [line.finalLine, line]));
  const lines = selected.map(line => {
    if (line.committed) {
      const origin = byLine.get(line.oldLine);
      if (!origin) throw new GitError('Corrupt', 'Blame did not attribute a preserved working line');
      return { ...origin, finalLine: line.newLine };
    }
    return { oid: '0'.repeat(repo.algorithm === 'sha256' ? 64 : 40), path: params.path, originalLine: line.newLine,
      finalLine: line.newLine, text: line.line.replace(/\r?\n$/, ''), author: 'Not committed yet', committer: '',
      summary: 'Uncommitted changes', boundary: false, uncommitted: true };
  });
  return { path: params.path, revision: oid, workingOid: mapping.workingOid, workingTree: true, total: mapping.lines.length, start, lines };
}
