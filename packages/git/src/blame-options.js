import { GitError, checkCancelled, checkLimit } from './errors.js';
import { getObjectFormat, validateObjectId } from './object-format.js';
import { validateCheckoutPath } from './path-safety.js';

/** Parse full object IDs with the comments and blank lines accepted by fsck.skipList. */
export function parseIgnoreRevs(text, { algorithm = 'sha1', maxRevisions = 100000, maxIgnoreFileBytes = 8 * 1024 * 1024 } = {}) {
  if (typeof text !== 'string') throw new TypeError('Ignored revisions must be UTF-8 text');
  checkLimit(text.length, maxIgnoreFileBytes, 'Ignore-revs text length');
  checkLimit(new TextEncoder().encode(text).byteLength, maxIgnoreFileBytes, 'Ignore-revs file bytes');
  const revisions = new Set();
  for (const line of text.split('\n')) {
    const value = line.split('#', 1)[0].trim();
    if (!value) continue;
    if (value.length !== getObjectFormat(algorithm).oidLength) {
      throw new GitError('Corrupt', 'Ignore-revs files require full object IDs');
    }
    revisions.add(validateObjectId(value, algorithm));
    checkLimit(revisions.size, maxRevisions, 'Ignored revision count');
  }
  return revisions;
}

function values(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

async function readIgnoreFile(repository, path, options) {
  checkCancelled(options.signal);
  let content;
  if (options.readIgnoreRevsFile) content = await options.readIgnoreRevsFile(path, { signal: options.signal });
  else {
    validateCheckoutPath(path);
    content = await repository.worktree?.read(path, { signal: options.signal });
  }
  if (content === undefined || content === null) {
    throw new GitError('NotFound', 'The ignore-revs file does not exist', { path });
  }
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content.data ?? content;
  if (!(bytes instanceof Uint8Array)) throw new TypeError('An ignore-revs file reader must return text or bytes');
  checkLimit(bytes.byteLength, options.maxIgnoreFileBytes ?? 8 * 1024 * 1024, 'Ignore-revs file bytes');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new GitError('Corrupt', 'The ignore-revs file is not UTF-8 text', { path }); }
}

async function ignoredRevisions(repository, options) {
  if (repository.config && !repository.config.loaded) await repository.config.load({ signal: options.signal });
  const configured = repository.config?.getAll('blame.ignoreRevsFile') ?? [];
  const files = [...configured, ...values(options.ignoreRevsFile), ...values(options.ignoreRevsFiles)];
  checkLimit(files.length, 256, 'Ignore-revs file count');
  const fromFiles = new Set();
  for (const path of files) {
    if (path === '') { fromFiles.clear(); continue; }
    if (typeof path !== 'string') throw new GitError('Corrupt', 'An ignore-revs filename must be a string');
    const text = await readIgnoreFile(repository, path, options);
    for (const oid of parseIgnoreRevs(text, options)) {
      fromFiles.add(oid);
      checkLimit(fromFiles.size, options.maxRevisions ?? 100000, 'Ignored revision count');
    }
  }
  const ignored = new Set(fromFiles);
  const explicit = [...values(options.ignoreRevs), ...values(options.ignoreRev)];
  checkLimit(explicit.length, options.maxRevisions ?? 100000, 'Ignored revision count');
  for (const revision of explicit) {
    checkCancelled(options.signal);
    ignored.add(await repository.revParse(revision, { signal: options.signal }));
  }
  checkLimit(ignored.size, options.maxRevisions ?? 100000, 'Ignored revision count');
  for (const oid of ignored) await repository.readCommit(oid, { signal: options.signal });
  return ignored;
}

/** Resolve mutable configuration once, before deriving immutable history-cache keys. */
export async function resolveBlameOptions(repository, options = {}) {
  const copyLevel = options.copyLevel ?? (typeof options.detectCopies === 'number' ? options.detectCopies : 1);
  checkLimit(copyLevel, 3, 'Blame copy search level');
  if (!copyLevel) throw new GitError('Corrupt', 'Blame copy search level must be between one and three');
  const detectCopies = !!options.detectCopies || options.copyLevel !== undefined;
  const settings = {
    ...options, algorithm: repository.algorithm ?? 'sha1',
    ignoreWhitespace: !!options.ignoreWhitespace, firstParent: !!options.firstParent,
    detectMoves: !!options.detectMoves || detectCopies, detectCopies, copyLevel,
    moveThreshold: checkLimit(options.moveThreshold ?? 20, 0x7fffffff, 'Blame move score'),
    copyThreshold: checkLimit(options.copyThreshold ?? 40, 0x7fffffff, 'Blame copy score'),
    maxCopyCandidates: checkLimit(options.maxCopyCandidates ?? 200, 100000, 'Blame copy candidates'),
    maxLines: checkLimit(options.maxLines ?? 1000000, 10000000, 'Blame line bound'),
    maxCommits: checkLimit(options.maxCommits ?? 100000, 10000000, 'Blame commit bound'),
    maxWork: checkLimit(options.maxWork ?? 20000000, Number.MAX_SAFE_INTEGER, 'Blame work bound')
  };
  settings.ignored = await ignoredRevisions(repository, settings);
  return settings;
}

export function blameCacheKey(revision, path, options, shallow) {
  return JSON.stringify([
    revision, path, options.ignoreWhitespace, options.firstParent, options.detectMoves, options.moveThreshold,
    options.detectCopies, options.copyLevel, options.copyThreshold, options.renameThreshold ?? 0.5,
    options.renameLimit ?? 200, options.diffAlgorithm ?? 'myers', !!options.showRoot,
    [...options.ignored].sort(), [...shallow].sort()
  ]);
}
