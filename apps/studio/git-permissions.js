import { GitError, GitPermissions } from '@sharpforge/git';

/** Show observed scopes and a separate acknowledgment when the provider cannot expose effective permissions. */
export function confirmGitWriteStatus(status, { document = globalThis.document, remote, description, signal } = {}) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Review Git write permissions');
    const title = document.createElement('h2');
    title.textContent = description ?? `Confirm ${status.operation}`;
    const details = document.createElement('p');
    details.textContent = `Repository: ${remote}. Observed scopes: ${status.scopes.join(', ') || 'none reported'}. ` +
      `Evidence: ${status.scopeSource}.`;
    const explanation = document.createElement('p');
    explanation.setAttribute('role', 'status');
    const insufficient = status.state === 'known-insufficient';
    const unknown = status.state === 'unknown';
    explanation.textContent = insufficient ? `Write blocked. The token needs one of: ${status.missingScopes.join(', ')}.` :
      unknown ? 'The provider has not exposed this token’s effective permissions. This confirmation permits one requested write attempt; ' +
        'the provider will enforce repository access and token permissions. No scopes will be recorded as granted.' :
        'The observed token scopes cover this operation. The provider also enforces repository access and branch protection.';
    const acknowledgment = document.createElement('input');
    acknowledgment.type = 'checkbox';
    const label = document.createElement('label');
    label.append(acknowledgment, document.createTextNode(' I understand that permissions are unknown and authorize this write attempt.'));
    const confirm = document.createElement('button');
    confirm.textContent = unknown ? 'Attempt This Write' : 'Confirm Write';
    confirm.disabled = unknown;
    acknowledgment.addEventListener('change', () => { confirm.disabled = !acknowledgment.checked; });
    const cancel = document.createElement('button');
    cancel.textContent = insufficient ? 'Close' : 'Cancel';
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', abort);
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const abort = () => finish(false);
    confirm.addEventListener('click', () => {
      if (!insufficient && (!unknown || acknowledgment.checked)) finish({ confirmed: true, allowUnverified: unknown });
    });
    cancel.addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    signal?.addEventListener('abort', abort, { once: true });
    dialog.append(title, details, explanation);
    if (unknown) dialog.append(label);
    dialog.append(cancel);
    if (!insufficient) dialog.append(confirm);
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
    if (signal?.aborted) finish(false);
  });
}

/** Modal permission review for direct package clients; unknown scopes never pass a generic boolean confirmation. */
export function createGitPermissionDialog(options = {}) {
  return new GitPermissions({ confirm: status => confirmGitWriteStatus(status, { ...options, ...status }) });
}

/** Inspect worker-held credentials, then return consent bound to this remote and operation only. */
export async function requestGitWriteConsent(workbench, {
  remote, remoteId, credentialId, operation, description, signal, document = globalThis.document
}) {
  if (signal?.aborted) throw new GitError('Cancelled', 'Write permission review cancelled');
  const status = await workbench.request('git.auth', { method: 'inspectCredential', params: {
    credentialId, remoteId, remote, operation
  } }, { signal });
  if (signal?.aborted) throw new GitError('Cancelled', 'Write permission review cancelled');
  const result = await confirmGitWriteStatus(status, { remote, description, signal, document });
  if (signal?.aborted) throw new GitError('Cancelled', 'Write permission review cancelled');
  if (status.state === 'known-insufficient') throw new GitError('Auth', 'Token lacks the required write scope', status);
  if (!result?.confirmed) throw new GitError('Cancelled', 'Git write was not confirmed');
  return { remoteId, scope: operation, confirmed: true, ...(result.allowUnverified ? { allowUnverified: true } : {}) };
}
