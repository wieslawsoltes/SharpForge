import { GitError, checkCancelled, checkLimit, validateCheckoutPath } from '@sharpforge/git';
import { decodeWorkspaceFile } from '@sharpforge/archive';
import { gitElement, gitButton } from './git-dom.js';
import { readGitPullRequest } from './git-pull-requests.js';

const source = 'git-review';
const oid = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value) ? value.toLowerCase() : null;
const lineNumber = value => Number.isSafeInteger(value) && value > 0 && value <= 10000000 ? value : null;
const safeUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
};

/** Provider positions become current, new-side file lines. Old or untracked positions remain readable text only. */
export function gitReviewComments(provider, threads, { maximumComments = 10000, maximumText = 4 * 1024 * 1024 } = {}) {
  if (!Array.isArray(threads)) throw new GitError('Corrupt', 'Review threads must be an array');
  checkLimit(threads.length, maximumComments, 'Review thread count');
  const result = [];
  let characters = 0;
  const add = (comment, location = {}) => {
    if (comment.deleted || comment.isDeleted || comment.system || comment.commentType === 'system') return;
    checkLimit(result.length + 1, maximumComments, 'Review comment count');
    const body = String(comment.body ?? comment.content?.raw ?? comment.content ?? '');
    const author = String(comment.author?.login ?? comment.author?.username ?? comment.author?.displayName ?? comment.user?.display_name ??
      comment.user?.login ?? comment.user?.username ?? 'Reviewer');
    checkLimit(body.length, 65536, 'Review comment length');
    checkLimit(characters += body.length + author.length, maximumText, 'Review text');
    let path = location.path;
    try { if (provider === 'azure') path = path?.replace(/^\//, ''); validateCheckoutPath(path); }
    catch { path = null; }
    const line = lineNumber(location.line);
    result.push(Object.freeze({ id: `${location.thread ?? ''}:${comment.id ?? result.length}`, body, author,
      path, line: path && !location.outdated ? line : null, headOid: oid(location.headOid),
      outdated: Boolean(location.outdated), resolved: Boolean(location.resolved),
      url: safeUrl(comment.url ?? comment.html_url ?? comment.links?.html?.href) }));
  };
  for (const thread of threads) {
    if (provider === 'github') {
      for (const comment of thread.comments?.nodes ?? []) add(comment, { thread: thread.id, path: thread.path,
        line: thread.diffSide === 'RIGHT' ? thread.line : null, outdated: thread.isOutdated, resolved: thread.isResolved });
    } else if (provider === 'gitlab') {
      for (const comment of thread.notes ?? []) add(comment, { thread: thread.id, path: comment.position?.new_path,
        line: comment.position?.new_line, headOid: comment.position?.head_sha, resolved: comment.resolved,
        outdated: Boolean(comment.position && !oid(comment.position.head_sha)) });
    } else if (provider === 'bitbucket') {
      add(thread, { path: thread.inline?.path, line: thread.inline?.to, outdated: thread.inline?.outdated });
    } else if (provider === 'azure') {
      if (thread.isDeleted) continue;
      const context = thread.pullRequestThreadContext;
      const tracked = context?.trackingCriteria?.secondComparingIteration ?? context?.iterationContext?.secondComparingIteration;
      for (const comment of thread.comments ?? []) add(comment, { thread: thread.id, path: thread.threadContext?.filePath,
        line: thread.threadContext?.rightFileStart?.line, headOid: thread.reviewedHeadOid,
        outdated: !oid(thread.reviewedHeadOid) || tracked !== thread.reviewedIteration,
        resolved: ['fixed', 'closed', 'wontFix', 'byDesign'].includes(thread.status) });
    } else if (provider === 'gitea') {
      if (thread.body) add(thread, { thread: thread.id });
      // Gitea maps LineNum to JSON position and OldLineNum to original_position (unlike GitHub diff offsets).
      for (const comment of thread.comments ?? []) add(comment, { thread: thread.id, path: comment.path,
        line: comment.position, headOid: comment.commit_id, outdated: thread.stale || !oid(comment.commit_id),
        resolved: Boolean(comment.resolver) });
    } else throw new GitError('Unsupported', 'Unsupported review provider');
  }
  return result;
}

/** Double-read the PR head so comments cannot silently cross an observed source-branch update. */
export async function readGitReview(workbench, target, number, options = {}) {
  const first = await readGitPullRequest(workbench, target, number, options);
  const threads = await workbench.request('git.provider', { ...first.identity,
    operation: 'listReviewThreads', input: { number } }, options);
  const latest = await readGitPullRequest(workbench, first.identity, number, options);
  if (!first.pullRequest.sourceOid || latest.pullRequest.sourceOid !== first.pullRequest.sourceOid) {
    throw new GitError('Conflict', 'The pull request source changed while reading its review. Refresh the review');
  }
  return { ...latest, comments: gitReviewComments(target.provider, threads) };
}

/** Attach one exact source file through the host's owned annotation contribution service. */
export async function annotateGitReviewFile(workbench, review, path, options = {}) {
  validateCheckoutPath(path);
  checkCancelled(options.signal);
  const annotations = workbench.host.services.get('annotations');
  const repositoryId = workbench.repositoryId;
  const workspace = workbench.host.getWorkspaceIdentity();
  const headOid = review.pullRequest.sourceOid;
  if (!repositoryId || !workbench.workspaceBound || !oid(headOid)) {
    throw new GitError('Conflict', 'Check out this pull request before showing source review annotations');
  }
  const assertCurrent = () => {
    checkCancelled(options.signal);
    if (repositoryId !== workbench.repositoryId || workspace !== workbench.host.getWorkspaceIdentity() || !workbench.workspaceBound) {
      throw new GitError('Conflict', 'The repository or workspace changed while opening review annotations');
    }
  };
  assertCurrent();
  if ((await workbench.request('head', {}, options)).oid !== headOid) {
    throw new GitError('Conflict', 'The checked-out commit differs from this pull request head');
  }
  const file = await workbench.request('readFile', { revision: headOid, path }, options);
  assertCurrent();
  const expected = decodeWorkspaceFile(path, file.data).text;
  if (typeof expected !== 'string') throw new GitError('Unsupported', 'Review annotations require a text source file');
  await workbench.host.openFile(path);
  assertCurrent();
  const editor = workbench.host.getEditors().get(workbench.host.getState().active);
  if (!editor || editor.uri !== path || editor.value !== expected || (await workbench.request('head', {}, options)).oid !== headOid) {
    throw new GitError('Conflict', 'Review annotations require the unchanged file at this pull request head');
  }
  assertCurrent();
  if (editor.uri !== path || editor.value !== expected) throw new GitError('Conflict', 'The source file changed while reading its review');
  const text = editor.sourceSnapshot();
  const comments = review.comments.filter(comment => comment.path === path && comment.line && !comment.outdated &&
    comment.line <= text.lineStarts.length && (!comment.headOid || comment.headOid === headOid));
  const diagnostics = comments.map(comment => {
    const start = text.lineStarts[comment.line - 1];
    const end = text.lineStarts[comment.line] ?? text.length;
    return { id: `${source}:${comment.id}`, code: 'GitReview', severity: 'info',
      message: `${comment.author}: ${comment.body}`, start, length: Math.max(1, end - start),
      range: { start: { line: comment.line - 1, character: 0 }, end: { line: comment.line - 1, character: Math.max(1, end - start) } } };
  });
  if (!diagnostics.length) throw new GitError('NotFound', 'No current review comments have a valid position in this source file');
  workbench.reviewAnnotations?.dispose();
  const document = editor.element.ownerDocument;
  const card = gitElement(document, 'aside', { className: 'git-review-annotations', 'aria-label': 'Pull request review annotations' },
    gitElement(document, 'h3', { text: `Review #${review.pullRequest.id} · ${path}` }));
  let page = 0;
  let disposed = false;
  const entries = gitElement(document, 'div');
  const current = () => !disposed && editor.uri === path && editor.value === expected &&
    repositoryId === workbench.repositoryId && workspace === workbench.host.getWorkspaceIdentity() && workbench.workspaceBound &&
    (workbench.headOid === undefined || workbench.headOid === headOid);
  const draw = () => {
    if (!current()) { dispose(); return; }
    entries.replaceChildren(...comments.slice(page * 50, page * 50 + 50).map(comment => gitElement(document, 'article', {},
      gitButton(document, `${comment.author} · line ${comment.line}`, () => {
        if (current()) editor.gotoLine(comment.line); else dispose();
      }), gitElement(document, 'p', { text: comment.body }))));
  };
  card.append(entries, gitButton(document, 'Previous review comments', () => { page = Math.max(0, page - 1); draw(); }),
    gitButton(document, 'Next review comments', () => { page = Math.min(Math.ceil(comments.length / 50) - 1, page + 1); draw(); }),
    gitButton(document, 'Clear review annotations', () => dispose()));
  const onEdit = () => { if (!current()) dispose(); };
  const unsubscribe = workbench.host.services.get('documents').subscribe(event => {
    if (event.uri === path || !current()) dispose();
  });
  editor.input?.addEventListener('input', onEdit);
  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    editor.input?.removeEventListener('input', onEdit);
    annotations.clear(source, path);
    card.remove();
    if (workbench.reviewAnnotations === handle) workbench.reviewAnnotations = null;
  }
  const handle = { uri: path, headOid, dispose };
  workbench.reviewAnnotations = handle;
  try {
    editor.element.append(card);
    annotations.set(source, path, diagnostics);
    draw();
  } catch (error) { dispose(); throw error; }
  return handle;
}
