import { GitError, checkCancelled, checkLimit } from './errors.js';
import { historySession, previousPath, splitHistoryLines } from './history.js';
import { parseShallow } from './shallow.js';
import { resolveBlameOptions, blameCacheKey } from './blame-options.js';
import { BlameQueue } from './blame-queue.js';
import { blameChunks } from './blame-incremental.js';
import { mapIgnoredBlame } from './blame-ignore.js';
import { blameDiff, mapBlameDiff, normalizeBlameLines, partitionBlame, blameScores, findBlameCopies } from './blame-match.js';

/** Return final-line-ordered attribution; the incremental API performs the same cancellable traversal. */
export async function blame(repository, path, options = {}) {
  const result = [];
  for await (const chunk of blameIncremental(repository, path, options)) {
    for (const line of chunk.lines) result.push(line);
  }
  return result.sort((left, right) => left.finalLine - right.finalLine);
}

/** Yield immutable finalized chunks as history is explored; stopping iteration never publishes a partial cache. */
export async function* blameIncremental(repository, path, options = {}) {
  repository.check?.(options);
  checkCancelled(options.signal);
  if (typeof path !== 'string' || !path || path.includes('\0')) throw new GitError('Corrupt', 'Blame requires a repository path');
  checkLimit(path.length, 32768, 'Blame path length');
  const settings = await resolveBlameOptions(repository, options);
  const revision = await repository.revParse(settings.revision ?? 'HEAD', { signal: settings.signal });
  const history = historySession(repository);
  const shallowBytes = await (repository.store ?? repository.odb?.store)?.get('shallow', { signal: settings.signal });
  const shallow = parseShallow(shallowBytes, settings);
  const key = blameCacheKey(revision, path, settings, shallow);
  const cached = history.blames.get(key);
  if (cached) {
    checkLimit(cached.length, settings.maxLines, 'Blame line count');
    yield* emitChunks(selectedLines(cached, settings), settings);
    return;
  }
  const tree = await history.tree(revision, settings);
  const file = tree.get(path);
  if (!file) throw new GitError('NotFound', 'Blame path does not exist in the selected revision', { path });
  const lines = await sourceLines(history, file, settings);
  selectedLines(lines, settings);
  const budget = { work: 0, maximum: settings.maxWork, signal: settings.signal };
  const output = new Array(lines.length);
  const queue = new BlameQueue(repository, { signal: settings.signal });
  const context = {
    history, settings, budget, output, queue, shallow, lines,
    normalized: normalizeBlameLines(lines, settings), scores: settings.detectMoves ? blameScores(lines, budget) : undefined
  };
  await queue.add({ oid: revision, path, positions: lines.map((_, line) => ({ line, original: line })) });
  let visited = 0;
  while (queue.size) {
    checkCancelled(settings.signal);
    checkLimit(++visited, settings.maxCommits, 'Blame history traversals');
    const current = queue.take();
    const finalized = await attributeCurrent(current, context);
    await settings.onProgress?.({ phase: 'blame', commits: visited, remaining: queue.size });
    yield* emitChunks(finalized.filter(line => inRange(line, settings, lines.length)), settings);
  }
  for (let line = 0; line < output.length; line++) {
    if (!output[line]) throw new GitError('Corrupt', 'Blame traversal left unresolved lines');
  }
  checkCancelled(settings.signal);
  history.remember(history.blames, key, Object.freeze(output));
}

async function* emitChunks(lines, settings) {
  for (const chunk of blameChunks(lines)) {
    checkCancelled(settings.signal);
    await settings.onChunk?.(chunk);
    checkCancelled(settings.signal);
    yield chunk;
  }
}

async function sourceLines(history, file, settings) {
  if (file.mode === 0o160000 || file.mode === '160000') throw new GitError('Unsupported', 'A submodule has no line attribution');
  const text = await history.text(file.oid, settings);
  const lines = splitHistoryLines(text);
  checkLimit(lines.length, settings.maxLines, 'Blame line count');
  return lines;
}

async function loadOrigin(origin, context) {
  if (origin.loaded) return origin;
  origin.loaded = true;
  if (!origin.path) return origin;
  try { origin.lines = await sourceLines(context.history, origin.tree.get(origin.path), context.settings); }
  catch (error) { if (error.code === 'Unsupported') return origin; throw error; }
  origin.normalized = normalizeBlameLines(origin.lines, context.settings);
  return origin;
}

async function parentOrigins(current, tree, context) {
  if (context.shallow.has(current.oid)) return { origins: [] };
  let parents = current.commit.parents ?? [];
  if (context.settings.firstParent) parents = parents.slice(0, 1);
  checkLimit(parents.length, context.settings.maxParents ?? 1024, 'Blame parent count');
  const origins = [];
  for (const oid of parents) {
    const before = await context.history.tree(oid, context.settings);
    origins.push({ oid, tree: before, path: before.has(current.path) ? current.path : null });
  }
  // Native blame prefers an unchanged path in any parent before searching renamed paths.
  const unchanged = origins.find(origin => origin.path && origin.tree.get(origin.path).oid === tree.get(current.path).oid);
  if (unchanged) return { unchanged, origins };
  for (const origin of origins) {
    if (!origin.path) {
      origin.path = await previousPath(context.history, origin.tree, tree, current.path, { ...context.settings, follow: true });
    }
    if (origin.path && origin.tree.get(origin.path).oid === tree.get(current.path).oid) return { unchanged: origin, origins };
  }
  return { origins };
}

async function attributeCurrent(current, context) {
  const { history, settings, output, queue } = context;
  let remaining = current.positions.filter(position => !output[position.original]);
  if (!remaining.length) return [];
  const tree = await history.tree(current.oid, settings);
  const file = tree.get(current.path);
  if (!file) throw new GitError('Corrupt', 'Blame origin path disappeared', { oid: current.oid, path: current.path });
  const currentLines = await sourceLines(history, file, settings);
  const found = await parentOrigins(current, tree, context);
  if (found.unchanged) {
    await queue.add({ oid: found.unchanged.oid, path: found.unchanged.path, positions: remaining });
    return [];
  }
  const origins = found.origins;
  const distinct = new Set();
  const normalized = normalizeBlameLines(currentLines, settings);
  for (const origin of origins) {
    if (!remaining.length) break;
    if (!origin.path) continue;
    const oid = origin.tree.get(origin.path).oid;
    if (distinct.has(oid)) continue;
    distinct.add(oid);
    await loadOrigin(origin, context);
    if (!origin.lines) continue;
    origin.diff = mapBlameDiff(blameDiff(origin.normalized, normalized, settings, context.budget));
    remaining = await transferMapped(remaining, origin, origin.diff.mapping, context);
  }
  if (remaining.length && settings.ignored.has(current.oid)) {
    remaining = await attributeIgnored(remaining, currentLines, origins, context);
  }
  if (remaining.length && settings.detectMoves) remaining = await attributeMoves(remaining, origins, context);
  if (remaining.length && settings.detectCopies) remaining = await attributeCopies(remaining, current, tree, origins, context);
  return finalizeLines(current, remaining, context);
}

async function transferMapped(positions, origin, mapping, context, flags) {
  const { remaining, transferred } = partitionBlame(positions, mapping, flags);
  await context.queue.add({ oid: origin.oid, path: origin.path, positions: transferred });
  return remaining;
}

async function attributeIgnored(positions, lines, origins, context) {
  let remaining = positions;
  for (const origin of origins) {
    if (!remaining.length) break;
    if (!origin.diff) continue;
    const mapping = mapIgnoredBlame(origin.lines, lines, origin.diff.hunks, context.budget);
    remaining = await transferMapped(remaining, origin, mapping, context, { ignored: true });
    remaining = remaining.map(position => ({ ...position, unblamable: true }));
  }
  return remaining;
}

async function attributeMoves(positions, origins, context) {
  let remaining = positions;
  for (const origin of origins) {
    if (!remaining.length) break;
    await loadOrigin(origin, context);
    if (!origin.lines) continue;
    const source = async function* () { yield origin; };
    const found = await findBlameCopies(remaining, source, { ...context, options: context.settings, threshold: context.settings.moveThreshold });
    remaining = found.remaining;
    for (const transfer of found.transfers) await context.queue.add(transfer);
  }
  return remaining;
}

async function* copySources(current, tree, origin, context) {
  const { settings } = context;
  const all = settings.copyLevel === 3 || settings.copyLevel === 2 && origin.path !== current.path;
  const paths = [];
  for (const [path, entry] of origin.tree) {
    if (path === origin.path || entry.mode === 0o160000 || entry.mode === '160000') continue;
    const after = tree.get(path);
    if (!all && after?.oid === entry.oid && after?.mode === entry.mode) continue;
    paths.push(path);
  }
  checkLimit(paths.length, settings.maxCopyCandidates, 'Blame copy candidates');
  for (const path of paths.sort()) {
    const source = await loadOrigin({ oid: origin.oid, tree: origin.tree, path }, context);
    if (source.lines) yield source;
  }
}

async function attributeCopies(positions, current, tree, origins, context) {
  let remaining = positions;
  for (const origin of origins) {
    if (!remaining.length) break;
    const source = () => copySources(current, tree, origin, context);
    const found = await findBlameCopies(remaining, source, { ...context, options: context.settings, threshold: context.settings.copyThreshold });
    remaining = found.remaining;
    for (const transfer of found.transfers) await context.queue.add(transfer);
  }
  return remaining;
}

function finalizeLines(current, positions, context) {
  const boundary = context.shallow.has(current.oid) || !current.commit.parents?.length && !context.settings.showRoot;
  const author = Object.freeze({ ...current.commit.author });
  const committer = Object.freeze({ ...current.commit.committer });
  const records = [];
  for (const position of positions) {
    const record = Object.freeze({
      oid: current.oid, path: current.path, originalLine: position.line + 1,
      finalLine: position.original + 1, text: context.lines[position.original].replace(/\r?\n$/, ''),
      author, committer,
      summary: current.commit.message.split('\n', 1)[0], boundary,
      ...(position.ignored ? { ignored: true } : {}), ...(position.unblamable ? { unblamable: true } : {})
    });
    context.output[position.original] = record;
    records.push(record);
  }
  return records.sort((left, right) => left.finalLine - right.finalLine);
}

function inRange(line, options, total) {
  return line.finalLine >= (options.startLine ?? 1) && line.finalLine <= (options.endLine ?? total);
}

function selectedLines(lines, { startLine = 1, endLine = lines.length } = {}) {
  checkLimit(startLine, lines.length + 1, 'Blame first line');
  checkLimit(endLine, lines.length, 'Blame last line');
  if (startLine < 1 || endLine < startLine - 1) throw new GitError('Corrupt', 'Invalid blame line range');
  return lines.slice(startLine - 1, endLine);
}
