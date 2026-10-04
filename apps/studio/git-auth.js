import { GitError, personalAccessCredential, requiredGitOrigins, supportedAuthenticationFlows } from '@sharpforge/git';

/** PAT entry keeps secrets in an input and the explicit worker message only; no browser storage or logging. */
export function showGitAuthentication({ document = globalThis.document, remote, provider, remoteId,
  credentialId = remoteId, invoke, brokerOrigin, deviceFlow, pkceFlow, authorizationOrigins = [], signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new GitError('Cancelled', 'Git authentication cancelled')); return; }
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Git authentication');
    const title = document.createElement('h2');
    title.textContent = `Sign in to ${provider}`;
    const label = document.createElement('label');
    label.textContent = 'Personal access token';
    const token = document.createElement('input');
    token.type = 'password';
    token.autocomplete = 'off';
    token.setAttribute('aria-label', 'Personal access token');
    label.append(token);
    const username = document.createElement('input');
    username.type = 'text';
    username.autocomplete = 'username';
    username.setAttribute('aria-label', 'Username or email for Basic authentication');
    username.placeholder = 'Username or email (when required by provider)';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const origins = [...new Set([...requiredGitOrigins(remote, { provider, brokerOrigin }), ...authorizationOrigins])];
    const originText = document.createElement('p');
    originText.textContent = `Signing in grants connections to: ${origins.join(', ')}. Credentials stay in this session.`;
    const save = document.createElement('button');
    save.textContent = 'Sign in with token';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    const controller = new AbortController();
    const authButtons = [save];
    const busy = value => { for (const button of authButtons) button.disabled = value; };
    let complete = false;
    const finish = (result, error) => {
      if (complete) return;
      complete = true;
      token.value = '';
      signal?.removeEventListener('abort', abort);
      controller.abort();
      dialog.close();
      dialog.remove();
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(null, new GitError('Cancelled', 'Git authentication cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    const store = async credential => {
      if (complete || controller.signal.aborted) throw new GitError('Cancelled', 'Git authentication cancelled');
      const result = await invoke('setCredential', { id: credentialId, remoteId, credential, origins, grantConsent: true }, { signal: controller.signal });
      token.value = '';
      finish(result);
    };
    const fail = error => {
      if (complete) return;
      status.textContent = error instanceof GitError ? error.message : 'Authentication failed';
      busy(false);
    };
    save.addEventListener('click', async () => {
      busy(true);
      try {
        const credential = personalAccessCredential({ provider, token: token.value, username: username.value || undefined,
          allowedOrigins: requiredGitOrigins(remote, { provider }) });
        if (provider === 'bitbucket' && username.value) credential.scheme = 'Basic';
        await store(credential);
      } catch (error) { token.value = ''; fail(error); }
    });
    const flows = supportedAuthenticationFlows({ provider, brokerOrigin });
    if (flows.includes('device') && deviceFlow) {
      const device = document.createElement('button');
      authButtons.push(device);
      device.textContent = 'Sign in with a device code';
      device.addEventListener('click', async () => {
        busy(true);
        try {
          await store(await deviceFlow.authorize({ signal: controller.signal, onCode: value => {
            status.textContent = `Open ${value.verificationUri} and enter ${value.userCode}. Waiting for authorization…`;
          } }));
        } catch (error) { fail(error); }
      });
      dialog.append(device);
    }
    if (flows.includes('pkce') && pkceFlow) {
      const web = document.createElement('button');
      authButtons.push(web);
      web.textContent = 'Sign in in browser';
      web.addEventListener('click', async () => {
        busy(true);
        try { await store(await pkceFlow({ signal: controller.signal })); }
        catch (error) { fail(error); }
      });
      dialog.append(web);
    }
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    dialog.prepend(title, label, username, originText, status);
    dialog.append(save, cancel);
    document.body.append(dialog);
    dialog.showModal();
    token.focus();
  });
}
