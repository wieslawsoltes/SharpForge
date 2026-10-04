import { checkCancelled, detectGitProvider, validateFilter, validateRemoteUrl } from '@sharpforge/git';
import { gitDialog } from './git-dom.js';
import { openSnapshotFromRemote, gitSnapshotNotice } from './git-snapshot.js';
import { checkGitWorkspaceLoad } from './git-workspace-load.js';

function cloneOptions(values) {
  const url = validateRemoteUrl(values.url);
  const depth = Number(values.depth);
  if (!Number.isSafeInteger(depth) || depth < 0) throw new Error('History depth must be a non-negative whole number.');
  const filter = values.filter.trim() || undefined;
  if (filter) validateFilter(filter);
  return { url: url.href, branch: values.branch || undefined, depth: depth || undefined, filter };
}

/** An auth failure can retry the same empty destination after the clone journal restores its baseline. */
async function cloneWithAuthentication(workbench, values, repositoryId, options) {
  checkGitWorkspaceLoad(options);
  const request = cloneOptions(values);
  const provider = values.provider || detectGitProvider(request.url);
  if (values.authentication === 'sign-in' && !await workbench.preferences.signIn(request.url, provider, options)) {
    throw new Error('Authentication cancelled.');
  }
  const connect = async () => {
    const network = await workbench.preferences.networkParameters({ url: request.url, provider }, {
      anonymous: values.authentication === 'anonymous', signal: options.signal
    });
    checkGitWorkspaceLoad(options);
    return workbench.request('clone', { ...network, ...request, repositoryId }, options);
  };
  try { return await connect(); }
  catch (error) {
    if (error.code !== 'Auth' || values.authentication === 'anonymous' || !provider) throw error;
    checkCancelled(options.signal);
    if (!await workbench.preferences.signIn(request.url, provider, options)) throw new Error('Authentication cancelled.');
    checkCancelled(options.signal);
    return connect();
  }
}

/** Clone through the worker and load the resulting files through Studio's normal workspace loader. */
export function showGitCloneDialog(workbench) {
  return gitDialog(document, {
    title: 'Clone Repository', submitLabel: 'Clone', fields: [
      { name: 'url', label: 'Repository HTTPS URL', type: 'url', required: true },
      { name: 'branch', label: 'Branch (remote default when empty)' },
      { name: 'depth', label: 'History depth (0 for complete)', value: '0', type: 'number', min: 0, step: 1 },
      { name: 'filter', label: 'Partial clone filter', placeholder: 'Optional: blob:none or blob:limit=1048576' },
      { name: 'provider', label: 'Provider', value: '', options: [{ value: '', label: 'Detect from URL' },
        ...['github', 'gitlab', 'bitbucket', 'azure', 'gitea'].map(value => ({ value, label: value }))] },
      { name: 'authentication', label: 'Authentication', value: 'automatic', options: [
        { value: 'automatic', label: 'Use saved identity; prompt if required' },
        { value: 'sign-in', label: 'Choose token, device code or browser sign-in' },
        { value: 'anonymous', label: 'Anonymous' }
      ] },
      { name: 'algorithm', label: 'Remote object format', value: 'sha1', options: [
        { value: 'sha1', label: 'SHA-1' }, { value: 'sha256', label: 'SHA-256' }
      ] }
    ], onCancel: () => workbench.controller?.abort(),
    onSubmit: (values, dialog) => cloneGitRepository(workbench, values, { progress: message => dialog.progress(message) })
  });
}

/** Keep a newly cloned repository staged until its guarded Studio adoption commits. */
export function cloneGitRepository(workbench, values, { progress = () => {} } = {}) {
  return workbench.run(async operation => {
      workbench.assertWorktreeChange();
      workbench.confirmWorkspaceReplacement();
      const request = cloneOptions(values);
      const url = new URL(request.url);
      const repositoryId = `repo-${crypto.randomUUID()}`;
      const options = { ...operation, timeoutMs: 1200000, onProgress: event => {
        operation.onProgress(event);
        progress(event.message ?? `${event.phase ?? 'Cloning'} ${event.completed ?? ''}`);
      } };
      const opened = await workbench.request('init', { repositoryId, backend: 'indexeddb', algorithm: values.algorithm,
        name: url.pathname.split('/').filter(Boolean).at(-1) }, options);
      workbench.rememberRepository(opened);
      try { await cloneWithAuthentication(workbench, values, repositoryId, options); }
      catch (error) {
        const provider = values.provider || detectGitProvider(request.url);
        if (error.code !== 'Network' || !provider || !globalThis.confirm(
          `Git HTTP could not connect. ${gitSnapshotNotice}\n\nOpen files through the provider API?`)) throw error;
        await openSnapshotFromRemote(workbench, request.url, provider, { ...options,
          ref: values.branch || undefined, confirmMetadata: () => true });
        await workbench.request('close', { repositoryId }, options);
        workbench.repositories.delete(repositoryId);
        workbench.preferences.saveRepositories();
        return;
      }
      checkGitWorkspaceLoad(options);
      await workbench.adoptRepository(options, { openWorkspace: true, repositoryId });
      await workbench.applyIdentity(options);
      workbench.host.showPanel('git-changes');
  }, { workspace: true });
}

export { cloneOptions };
