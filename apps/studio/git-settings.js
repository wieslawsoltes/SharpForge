import { GitError, GitOriginGrants, requiredGitOrigins, requiredGitAuthenticationOrigins, SecretRedactor } from '@sharpforge/git';
import { createBrowserCsp } from '@sharpforge/network';

const defaults = Object.freeze({ userName: '', userEmail: '', defaultBranch: 'main', proxyOrigin: '', credentialPersistence: 'session',
  clientId: '', brokerOrigin: '', redirectUri: '', oauthTenant: 'organizations', oauthScopes: '' });

function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new GitError('Corrupt', 'Git settings must be an object');
  const result = {};
  for (const name of Object.keys(defaults)) {
    const value = input[name] ?? defaults[name];
    if (typeof value !== 'string' || value.length > 1024 || /[\u0000-\u001f]/.test(value)) {
      throw new GitError('Unsafe', 'Invalid Git setting', { setting: name });
    }
    result[name] = value;
  }
  if (result.userEmail && !/^[^\s<>@]+@[^\s<>@]+$/.test(result.userEmail)) throw new GitError('Unsafe', 'Enter a valid commit email');
  if (!result.defaultBranch || /[\s~^:?*\[\\]|\.\.|@\{/.test(result.defaultBranch) || result.defaultBranch.endsWith('.lock')) {
    throw new GitError('Unsafe', 'Enter a valid default branch name');
  }
  for (const name of ['proxyOrigin', 'brokerOrigin']) if (result[name]) {
    let url;
    try { url = new URL(result[name]); } catch { throw new GitError('Unsafe', `${name} must be an HTTPS origin`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new GitError('Unsafe', `${name} must be an exact HTTPS origin`);
    }
    result[name] = url.origin;
  }
  if (result.redirectUri) {
    let redirect;
    try { redirect = new URL(result.redirectUri); } catch { throw new GitError('Unsafe', 'OAuth redirect must be an HTTPS URL'); }
    if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.hash) {
      throw new GitError('Unsafe', 'OAuth redirect must be an HTTPS URL without credentials');
    }
    result.redirectUri = redirect.href;
  }
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(result.oauthTenant)) throw new GitError('Unsafe', 'Invalid Microsoft Entra tenant');
  if (!['session', 'encrypted'].includes(result.credentialPersistence)) throw new GitError('Unsafe', 'Unknown credential persistence mode');
  return result;
}

/** Persist only this closed settings schema. Credential values cannot enter Web Storage through this model. */
export class GitSettingsModel {
  constructor({ storage, key = 'sharpforge.git.settings.v1', grants = new GitOriginGrants(), remotes = [] } = {}) {
    Object.assign(this, { storage, key, grants, remotes });
    this.values = { ...defaults };
  }

  load() {
    const text = this.storage?.getItem(this.key);
    if (!text) return this.describe();
    let value;
    try { value = JSON.parse(text); } catch { throw new GitError('Corrupt', 'Saved Git settings are invalid'); }
    if (value.version !== 1) throw new GitError('Unsupported', 'Unknown Git settings version');
    this.values = validateSettings(value.settings);
    if (value.grants) this.grants = new GitOriginGrants({ grants: value.grants });
    return this.describe();
  }

  update(input) {
    const next = validateSettings({ ...this.values, ...input });
    const persisted = new SecretRedactor().value({ version: 1, settings: next, grants: this.grants.describe() });
    this.storage?.setItem(this.key, JSON.stringify(persisted));
    this.values = next;
    return this.describe();
  }

  describe() {
    const origins = new Set(this.grants.allowedOrigins());
    for (const remote of this.remotes) {
      for (const origin of requiredGitOrigins(remote.url, { provider: remote.provider, proxyOrigin: this.values.proxyOrigin || undefined })) {
        origins.add(origin);
      }
      for (const origin of requiredGitAuthenticationOrigins(remote.url, { provider: remote.provider, ...this.values })) origins.add(origin);
    }
    if (this.values.proxyOrigin) origins.add(this.values.proxyOrigin);
    if (this.values.brokerOrigin) origins.add(this.values.brokerOrigin);
    const requiredOrigins = [...origins].sort();
    return { ...this.values, grants: this.grants.describe(), requiredOrigins, csp: createBrowserCsp(requiredOrigins) };
  }
}

function element(document, tag, text, attributes = {}) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  for (const [key, content] of Object.entries(attributes)) value.setAttribute(key, content);
  return value;
}

/** Accessible settings surface. Host callbacks synchronize the worker and request the user's grants. */
export function createGitSettingsView({ document = globalThis.document, model, credentials = [], onSave,
  onGrant, onRevoke, onLogout, idPrefix = 'git-settings' } = {}) {
  const root = element(document, 'section', undefined, { 'aria-label': 'Git settings', class: 'git-settings' });
  const form = element(document, 'form');
  const status = element(document, 'p', '', { role: 'status', 'aria-live': 'polite' });
  const fields = new Map();
  const state = model.describe();
  for (const [name, title] of Object.entries({ userName: 'Commit author name', userEmail: 'Commit author email',
    defaultBranch: 'Default branch', proxyOrigin: 'Git proxy origin', clientId: 'OAuth public client ID',
    brokerOrigin: 'OAuth token broker origin', redirectUri: 'Registered OAuth redirect URI',
    oauthTenant: 'Microsoft Entra tenant', oauthScopes: 'Requested OAuth scopes (space separated)' })) {
    const label = element(document, 'label', title, { for: `${idPrefix}-${name}` });
    const input = element(document, 'input', undefined, { id: `${idPrefix}-${name}`, name, type: name === 'userEmail' ? 'email' : 'text' });
    input.value = state[name];
    fields.set(name, input);
    form.append(label, input);
  }
  const persistence = element(document, 'select', undefined, { id: `${idPrefix}-persistence`, name: 'credentialPersistence' });
  for (const [value, title] of [['session', 'This session only'], ['encrypted', 'Encrypted on this device']]) {
    const option = element(document, 'option', title, { value });
    persistence.append(option);
  }
  persistence.value = state.credentialPersistence;
  fields.set('credentialPersistence', persistence);
  form.append(element(document, 'label', 'Credential storage', { for: `${idPrefix}-persistence` }), persistence,
    element(document, 'button', 'Save Git settings', { type: 'submit' }));
  const csp = element(document, 'pre', state.csp, { 'aria-label': 'Required deployment Content Security Policy', tabIndex: '0' });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const next = Object.fromEntries([...fields].map(([name, input]) => [name, input.value]));
      const validated = validateSettings(next);
      await onSave?.(validated, { persistenceConsent: validated.credentialPersistence === 'encrypted' });
      csp.textContent = model.update(validated).csp;
      status.textContent = 'Git settings saved. Apply the displayed CSP to the host when origins change.';
    } catch (error) { status.textContent = error instanceof GitError ? error.message : 'Git settings could not be saved'; }
  });
  root.append(element(document, 'h2', 'Git settings'), form, status, element(document, 'h3', 'Remote origin grants'));
  root.append(element(document, 'p', 'OAuth requires your registered application and exact callback URI. ' +
    'Configure client secrets only on the broker server. Empty client ID keeps OAuth unavailable; token entry remains available.'));
  for (const remote of model.remotes) {
    const group = element(document, 'fieldset');
    group.append(element(document, 'legend', remote.id));
    for (const origin of requiredGitOrigins(remote.url, { provider: remote.provider, proxyOrigin: state.proxyOrigin || undefined })) {
      const button = element(document, 'button', model.grants.list(remote.id).includes(origin) ? `Revoke ${origin}` : `Grant ${origin}`, { type: 'button' });
      button.addEventListener('click', async () => {
        try {
          if (model.grants.list(remote.id).includes(origin)) {
            await onRevoke?.({ remoteId: remote.id, origin });
            model.grants.revoke(remote.id, origin);
            button.textContent = `Grant ${origin}`;
          } else {
            const origins = [...model.grants.list(remote.id), origin];
            await onGrant?.({ remoteId: remote.id, origins, consent: true });
            model.grants.grant(remote.id, origins);
            button.textContent = `Revoke ${origin}`;
          }
          model.update({});
        } catch (error) { status.textContent = error instanceof GitError ? error.message : 'Origin grant could not be changed'; }
      });
      group.append(button);
    }
    root.append(group);
  }
  root.append(element(document, 'h3', 'Signed-in accounts'));
  for (const credential of credentials) {
    const row = element(document, 'p', `${credential.provider}: ${credential.id} — ${(credential.scopes ?? []).join(', ') || 'Scopes unverified'} `);
    const logout = element(document, 'button', 'Sign out', { type: 'button' });
    logout.addEventListener('click', async () => {
      try { await onLogout?.(credential.id); row.remove(); }
      catch (error) { status.textContent = error instanceof GitError ? error.message : 'Sign out could not be completed'; }
    });
    row.append(logout);
    root.append(row);
  }
  root.append(element(document, 'h3', 'Required deployment policy'), csp);
  return root;
}
