import { GitError, checkCancelled, checkLimit } from '@sharpforge/git';
import { decodeWorkspaceFile, encodeWorkspaceFile } from '@sharpforge/archive';
import { gitElement, gitButton, gitField, gitDialog } from './git-dom.js';
import { providerTarget, authorizeProviderTarget } from './git-provider-session.js';
import { requestGitWriteConsent } from './git-permissions.js';
import { withGitWorkspaceLoad, checkGitWorkspaceLoad } from './git-workspace-load.js';
import { adoptGitWorkspace } from './git-workspace-adoption.js';

export const gitSnapshotNotice = 'A provider snapshot loads files from one remote commit. Original Git history, signatures, and ' +
  'commit metadata are not imported. New commits are created through the provider API using its advertised conflict checks.';

const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

function snapshotPath(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.startsWith('/') || value.includes('\\') ||
      /[\u0000-\u001f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    throw new GitError('Unsafe', 'Snapshot files must have safe repository-relative paths');
  }
  return value;
}

function snapshotMode(value) {
  const mode = typeof value === 'number' ? value.toString(8) : String(value ?? '100644');
  if (!['100644', '100755', '120000'].includes(mode)) throw new GitError('Unsupported', 'Snapshot file mode is unsupported');
  return mode;
}

async function sameBytes(left, right, signal) {
  if (left.length !== right.length) return false;
  for (let offset = 0; offset < left.length; offset += 1024 * 1024) {
    checkCancelled(signal);
    const end = Math.min(left.length, offset + 1024 * 1024);
    for (let index = offset; index < end; index++) if (left[index] !== right[index]) return false;
    if (end < left.length) await yieldTask();
  }
  return true;
}

/** Compare the actual Studio records to the opened snapshot, preserving original encoding and binary bytes. */
export async function snapshotChanges(snapshot, records, { signal } = {}) {
  checkLimit(records.length, 100000, 'Snapshot workspace files');
  const changes = [];
  const paths = new Set();
  let totalBytes = 0;
  let sinceYield = 0;
  for (const record of records) {
    checkCancelled(signal);
    const path = snapshotPath(record.path ?? record.uri);
    if (paths.has(path)) throw new GitError('Conflict', 'Workspace contains duplicate snapshot paths');
    paths.add(path);
    const before = snapshot.baseline.get(path);
    const content = encodeWorkspaceFile({ ...record, path });
    const mode = snapshotMode(record.mode ?? before?.mode);
    totalBytes += content.length;
    checkLimit(totalBytes, 64 * 1024 * 1024, 'Snapshot workspace bytes');
    if (!before || mode !== before.mode || !await sameBytes(content, before.content, signal)) {
      changes.push({ path, mode, content, previousOid: before?.oid ?? undefined });
    }
    sinceYield += content.length;
    if (sinceYield >= 1024 * 1024) { await yieldTask(); sinceYield = 0; }
  }
  for (const [path, before] of snapshot.baseline) {
    if (!paths.has(path)) changes.push({ path, mode: before.mode, delete: true, previousOid: before.oid });
  }
  checkLimit(changes.length, 10000, 'Snapshot changed files');
  return changes;
}

function currentSnapshot(workbench, expected = workbench.providerSnapshot) {
  if (!expected || workbench.providerSnapshot !== expected || expected.workspaceIdentity !== workbench.host.getWorkspaceIdentity()) {
    throw new GitError('Conflict', 'The active workspace no longer matches this provider snapshot. Open its snapshot again before committing.');
  }
  if (expected.writesBlocked) throw new GitError('Conflict', expected.writesBlocked);
  return expected;
}

async function snapshotRequests(workbench, target, options, assertCurrent) {
  let authorized = await authorizeProviderTarget(workbench, target, undefined, options);
  assertCurrent();
  let retriedAuthentication = false;
  return async (operation, input) => {
    assertCurrent();
    let result;
    try { result = await workbench.request('git.snapshot', { ...authorized, operation, input }, options); }
    catch (error) {
      if (error.code !== 'Auth' || retriedAuthentication || !['refs', 'read'].includes(operation)) throw error;
      retriedAuthentication = true;
      assertCurrent();
      const credential = await workbench.preferences.signIn(target.remote, target.provider, { signal: options.signal });
      assertCurrent();
      if (!credential) throw new GitError('Cancelled', 'Snapshot sign-in was cancelled');
      authorized = await authorizeProviderTarget(workbench, target, undefined, options);
      assertCurrent();
      result = await workbench.request('git.snapshot', { ...authorized, operation, input }, options);
    }
    assertCurrent();
    return result;
  };
}

/** Capture before provider prompts/reads and reuse the caller's ticket through source adoption. */
export function openSnapshotFromRemote(workbench, remote, provider, options = {}) {
  return withGitWorkspaceLoad(workbench.host, options, context => loadRemoteSnapshot(workbench, remote, provider, context));
}

async function loadRemoteSnapshot(workbench, remote, provider, options) {
  const repositoryId = workbench.repositoryId;
  const assertCurrent = () => {
    checkGitWorkspaceLoad(options);
    workbench.assertWorktreeChange?.();
    if (workbench.repositoryId !== repositoryId) throw new GitError('Conflict', 'The repository changed during snapshot loading');
  };
  assertCurrent();
  const target = providerTarget(remote, provider);
  const confirm = options.confirmMetadata ?? globalThis.confirm;
  if (confirm && !await confirm(`${gitSnapshotNotice}\n\nOpen ${target.remote} as a snapshot?`)) {
    throw new GitError('Cancelled', 'Provider snapshot loading cancelled');
  }
  assertCurrent();
  const request = await snapshotRequests(workbench, target, options, assertCurrent);
  const capabilities = await request('capabilities');
  let ref = options.ref;
  if (!ref) {
    const refs = (await request('refs')).filter(value => value.name.startsWith('refs/heads/'));
    ref = refs.find(value => value.name === 'refs/heads/main')?.name ??
      refs.find(value => value.name === 'refs/heads/master')?.name ?? refs[0]?.name;
    if (!ref) throw new GitError('NotFound', 'Provider repository has no branch to open');
  }
  const snapshot = await request('read', { ref });
  assertCurrent();
  workbench.confirmWorkspaceReplacement();
  const records = [];
  const baseline = new Map();
  let decodedBytes = 0;
  for (const file of snapshot.files) {
    assertCurrent();
    const path = snapshotPath(file.path);
    const mode = snapshotMode(file.mode);
    if (baseline.has(path)) throw new GitError('Conflict', 'Provider snapshot contains duplicate file paths');
    baseline.set(path, { ...file, mode });
    records.push({ ...decodeWorkspaceFile(path, file.content), mode });
    decodedBytes += file.content.length;
    if (records.length % 100 === 0 || decodedBytes >= 1024 * 1024) { await yieldTask(); decodedBytes = 0; }
  }
  assertCurrent();
  workbench.blameMargin?.dispose();
  workbench.blameMargin = null;
  await workbench.reviewAnnotations?.dispose();
  workbench.reviewAnnotations = null;
  assertCurrent();
  await adoptGitWorkspace(workbench, records, options, { openWorkspace: true,
    name: new URL(target.remote).pathname.split('/').filter(Boolean).at(-1)?.replace(/\.git$/, '') },
  () => publishSnapshot(workbench, target, snapshot, baseline, capabilities));
  workbench.host.showPanel('git-snapshot');
  return workbench.providerSnapshot;
}

function publishSnapshot(workbench, target, snapshot, baseline, capabilities) {
  const currentPaths = new Set(workbench.host.snapshot().map(record => record.path ?? record.uri));
  const missing = [...baseline.keys()].filter(path => !currentPaths.has(path));
  workbench.repositoryId = null;
  workbench.workspaceBound = false;
  workbench.synced.clear();
  workbench.changes = [];
  workbench.allChanges = [];
  workbench.aheadBehind = null;
  workbench.branch = snapshot.ref.replace(/^refs\/heads\//, '');
  workbench.providerSnapshot = { ...target, ref: snapshot.ref, oid: snapshot.oid, commit: snapshot.commit, baseline, capabilities,
    workspaceIdentity: workbench.host.getWorkspaceIdentity(), writesBlocked: missing.length ?
      'Studio did not retain every snapshot file. Commits are disabled to prevent unintended remote deletions.' : null };
  workbench.snapshotSelection = { ...target, ref: snapshot.ref };
}

/** Commit the submitted source records against the exact opened head; failed CAS never advances the baseline. */
export async function commitProviderSnapshot(workbench, { message, consistency = 'strict', writeConsent, snapshot } = {}, options = {}) {
  const state = currentSnapshot(workbench, snapshot);
  if (writeConsent?.confirmed !== true || writeConsent.remoteId !== state.remoteId || writeConsent.scope !== 'push') {
    throw new GitError('Auth', 'Snapshot commit requires confirmation for this remote');
  }
  const files = await snapshotChanges(state, workbench.host.snapshot(), options);
  if (!files.length) throw new GitError('Conflict', 'No snapshot files have changed');
  const authorized = await authorizeProviderTarget(workbench, state);
  currentSnapshot(workbench, state);
  const { userName, userEmail } = workbench.preferences.model.values;
  const result = await workbench.request('git.snapshot', { ...authorized, operation: 'commit', consistency, writeConsent,
    input: { ref: state.ref, expectedOid: state.oid, message, files,
      ...(userName && userEmail ? { author: { name: userName, email: userEmail } } : {}) } }, options);
  if (!result.refUpdated || !/^[a-f0-9]{40}$/.test(result.oid)) throw new GitError('Corrupt', 'Provider did not confirm the snapshot reference update');
  for (const file of files) {
    if (file.delete) state.baseline.delete(file.path);
    else state.baseline.set(file.path, { path: file.path, mode: file.mode, oid: null, content: file.content.slice() });
  }
  state.commit = { oid: result.oid, parents: [state.oid], message };
  state.oid = result.oid;
  if (consistency !== 'strict') state.writesBlocked = 'This commit used weaker branch conflict checks. Reload the remote snapshot before another commit.';
  return result;
}

function commitDialog(document, workbench, state) {
  const choices = [{ value: 'strict', label: 'Atomic branch comparison (default)' }];
  if (state.provider === 'gitlab' || state.provider === 'gitea') choices.push({ value: 'file', label: 'Per-file checks; branch update is not atomic' });
  if (state.provider === 'bitbucket') choices.push({ value: 'non-atomic-parent', label: 'Parent only; concurrent branch changes may be lost' });
  return gitDialog(document, { title: `Commit snapshot to ${state.ref} at ${state.remote}`, submitLabel: 'Commit and Update Remote', fields: [
    { name: 'message', label: 'Commit message', required: true, multiline: true },
    { name: 'consistency', label: 'Remote conflict guarantee', value: 'strict', options: choices }
  ], onSubmit: values => workbench.run(async options => {
    const authorized = await authorizeProviderTarget(workbench, currentSnapshot(workbench, state));
    const writeConsent = await requestGitWriteConsent(workbench, { ...authorized, operation: 'push',
      description: `Commit snapshot and update ${state.ref}`, document, signal: options.signal });
    return commitProviderSnapshot(workbench, { ...values, snapshot: state, writeConsent }, options);
  }) });
}

/** Snapshot files use the existing Studio editor and source records; the panel only owns provider metadata. */
export async function renderGitSnapshot(element, workbench) {
  const document = element.ownerDocument;
  const selected = workbench.snapshotSelection ?? workbench.providerSelection ?? { provider: 'github', remote: '' };
  const provider = gitElement(document, 'select', {}, ...['github', 'gitlab', 'bitbucket', 'azure', 'gitea']
    .map(value => gitElement(document, 'option', { value, text: value })));
  provider.value = selected.provider;
  const remote = gitElement(document, 'input', { type: 'url', value: selected.remote, placeholder: 'Repository HTTPS URL' });
  const ref = gitElement(document, 'input', { value: selected.ref ?? '', placeholder: 'main, master, or another branch' });
  const notice = gitElement(document, 'p', { text: gitSnapshotNotice, role: 'note' });
  const state = workbench.providerSnapshot;
  const status = gitElement(document, 'p', { role: 'status', text: state ? `${state.ref} · ${state.oid}` : 'Open a remote snapshot to edit its files.' });
  const toolbar = gitElement(document, 'div', { className: 'git-toolbar' },
    gitButton(document, 'Open Snapshot', () => workbench.safe(() => workbench.run(options =>
      openSnapshotFromRemote(workbench, remote.value, provider.value, { ...options, ref: ref.value || undefined }), { workspace: true }))),
    gitButton(document, 'Sign In…', () => workbench.safe(() => workbench.preferences.signIn(remote.value, provider.value))),
    gitButton(document, 'Refresh Changes', () => workbench.safe(() => workbench.renderMounted())),
    gitButton(document, 'Commit Snapshot…', () => workbench.safe(() => commitDialog(document, workbench, currentSnapshot(workbench))),
      { disabled: !state || Boolean(state.writesBlocked) }));
  const list = gitElement(document, 'div', { className: 'git-provider-list', role: 'list' });
  const search = gitElement(document, 'input', { type: 'search', placeholder: 'Filter snapshot files', 'aria-label': 'Filter snapshot files' });
  element.replaceChildren(notice, gitElement(document, 'div', { className: 'git-provider-form' },
    gitField(document, 'Provider', provider), gitField(document, 'Repository URL', remote), gitField(document, 'Branch', ref)),
  toolbar, status, search, list);
  const controller = new AbortController();
  if (!state) return () => controller.abort();
  if (state.workspaceIdentity !== workbench.host.getWorkspaceIdentity()) {
    status.textContent = 'The workspace changed. Open this remote snapshot again to review or commit its files.';
    return () => controller.abort();
  }
  const records = workbench.host.snapshot();
  const changes = await snapshotChanges(state, records, { signal: controller.signal });
  const changed = new Map(changes.map(file => [file.path, file.delete ? 'deleted' : state.baseline.has(file.path) ? 'modified' : 'added']));
  status.textContent += ` · ${changed.size} changed files${state.writesBlocked ? ` · ${state.writesBlocked}` : ''}`;
  const files = [...new Map([...records.map(record => [record.path ?? record.uri, record]),
    ...changes.filter(file => file.delete).map(file => [file.path, file])]).entries()];
  let page = 0;
  const draw = () => {
    const filtered = files.filter(([path]) => path.toLowerCase().includes(search.value.toLowerCase()));
    const start = page * 100;
    list.replaceChildren(...filtered.slice(start, start + 100).map(([path, record]) => gitElement(document, 'div', { role: 'listitem' },
      gitButton(document, path, () => workbench.host.openFile(path), { disabled: record.delete || typeof record.text !== 'string' }),
      gitElement(document, 'span', { text: ` ${changed.get(path) ?? 'unchanged'}${typeof record.text === 'string' ? '' : ' · binary bytes preserved'}` }))));
    list.append(gitButton(document, 'Previous files', () => { page--; draw(); }, { disabled: page === 0 }),
      gitButton(document, 'Next files', () => { page++; draw(); }, { disabled: start + 100 >= filtered.length }));
  };
  search.addEventListener('input', () => { page = 0; draw(); });
  draw();
  return () => controller.abort();
}
