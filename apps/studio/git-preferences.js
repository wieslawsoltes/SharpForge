import { GitOriginGrants, requiredGitOrigins, detectGitProvider } from '@sharpforge/git';
import { GitSettingsModel, createGitSettingsView } from './git-settings.js';
import { showGitAuthentication } from './git-auth.js';
import { createGitAuthSetup } from './git-auth-setup.js';
import { requestGitWriteConsent } from './git-permissions.js';
import { gitElement, gitButton, gitDialog } from './git-dom.js';

const catalogKey = 'sharpforge.git.repositories.v1';

/** A closed metadata catalog: tokens and directory handles never enter Web Storage. */
export class GitPreferences {
  constructor(workbench, storage = globalThis.localStorage) {
    this.workbench = workbench;
    this.storage = storage;
    this.model = new GitSettingsModel({ storage });
    this.model.load();
  }

  readRepositories() {
    const text = this.storage?.getItem(catalogKey);
    if (!text) return [];
    const saved = JSON.parse(text);
    if (saved.version !== 1 || !Array.isArray(saved.repositories) || saved.repositories.length > 128) {
      throw new Error('Saved Git repository catalog is invalid.');
    }
    return saved.repositories.filter(item => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(item.repositoryId) &&
      ['indexeddb', 'opfs'].includes(item.backend) && ['sha1', 'sha256'].includes(item.algorithm));
  }

  saveRepositories() {
    const repositories = [...this.workbench.repositories.values()].filter(item => ['indexeddb', 'opfs'].includes(item.backend))
      .map(({ repositoryId, name, backend, algorithm }) => ({ repositoryId, name: String(name).slice(0, 256), backend, algorithm }));
    this.storage?.setItem(catalogKey, JSON.stringify({ version: 1, repositories }));
  }

  async restoreGrants() {
    for (const [remoteId, origins] of Object.entries(this.model.grants.describe())) {
      await this.workbench.client.request('git.auth', { method: 'grant', input: { remoteId, origins, consent: true } });
    }
    if (this.model.values.credentialPersistence === 'encrypted') {
      await this.workbench.client.request('git.auth', {
        method: 'configurePersistence', input: { mode: 'encrypted', consent: true }
      });
    }
  }

  auth(method, input = {}, options) { return this.workbench.request('git.auth', { method, input }, options); }

  async grant(remote, provider, { consent = false } = {}) {
    const remoteId = new URL(remote).origin;
    const origins = requiredGitOrigins(remote, { provider, proxyOrigin: this.model.values.proxyOrigin || undefined });
    const missing = origins.filter(origin => !this.model.grants.list(remoteId).includes(origin));
    if (missing.length && !consent) {
      const accepted = globalThis.confirm(`Allow this Git remote to connect to:\n${missing.join('\n')}?`);
      if (!accepted) throw new Error('Remote connection grant cancelled.');
    }
    if (missing.length) {
      const combined = [...new Set([...this.model.grants.list(remoteId), ...origins])];
      await this.auth('grant', { remoteId, origins: combined, consent: true });
      this.model.grants.grant(remoteId, combined);
      this.model.update({});
    }
    return remoteId;
  }

  async signIn(remote, provider = detectGitProvider(remote), { signal } = {}) {
    if (!provider) throw new Error('Select the provider in Pull Requests & Issues before signing in to this host.');
    const remoteId = new URL(remote).origin;
    const setup = createGitAuthSetup({ settings: this.model, grants: this.model.grants,
      invoke: (method, input, options) => this.auth(method, input, { signal, ...options }), remote, provider, remoteId });
    const result = await showGitAuthentication({ remote, provider, remoteId, credentialId: remoteId,
      ...setup, signal, invoke: (method, input, options) => this.auth(method, input, { signal, ...options }) });
    if (result) {
      const state = await this.auth('describeGrants');
      this.model.grants = new GitOriginGrants({ grants: state.grants });
      this.model.update({});
      this.workbench.credentialIds.set(remoteId, result.id);
    }
    return result;
  }

  async networkParameters(remote, { write = false, anonymous = false, signal } = {}) {
    if (write && anonymous) throw new Error('Select a credential before pushing.');
    const remoteId = await this.grant(remote.url, remote.provider);
    const credentials = anonymous ? [] : await this.auth('listCredentials', {}, { signal });
    const credentialId = anonymous ? undefined
      : this.workbench.credentialIds.get(remoteId) ?? credentials.find(item => item.id === remoteId)?.id;
    const writeConsent = write ? await requestGitWriteConsent(this.workbench, {
      remote: remote.url, remoteId, credentialId, operation: 'push',
      description: `Push local commits and references to ${remote.url}`, signal
    }) : undefined;
    const proxy = this.model.values.proxyOrigin;
    const forward = credentialId && proxy ? globalThis.confirm(`Forward this remote's credential through your proxy at ${proxy}?`) : false;
    if (credentialId && proxy && !forward) throw new Error('Credential forwarding cancelled.');
    return { url: remote.url, remoteName: remote.name ?? 'origin', remoteId, credentialId, anonymous,
      ...(proxy ? { proxyUrl: `${proxy}/git` } : {}),
      ...(forward ? { credentialForwardOrigins: [proxy], credentialForwardConsent: true } : {}),
      ...(write ? { writeConsent } : {}) };
  }
}

export async function renderGitSettings(element, workbench) {
  const document = element.ownerDocument;
  const preferences = workbench.preferences;
  const remotes = workbench.repositoryId ? await workbench.request('remotes') : [];
  if (workbench.providerSelection?.remote) remotes.push({ name: 'Provider', url: workbench.providerSelection.remote,
    provider: workbench.providerSelection.provider });
  preferences.model.remotes = remotes.map(remote => ({ ...remote, id: new URL(remote.url).origin }));
  const credentials = await preferences.auth('listCredentials');
  const view = createGitSettingsView({ document, model: preferences.model, credentials,
    onSave: async (values, { persistenceConsent }) => {
      await preferences.auth('configurePersistence', { mode: values.credentialPersistence, consent: persistenceConsent });
      if (workbench.repositoryId) await workbench.request('configuration', { changes: {
        'user.name': values.userName, 'user.email': values.userEmail, 'init.defaultBranch': values.defaultBranch
      } });
    },
    onGrant: value => preferences.auth('grant', value), onRevoke: value => preferences.auth('revokeGrant', value),
    onLogout: id => preferences.auth('logout', { id })
  });
  const actions = gitElement(document, 'div', { className: 'git-toolbar' },
    gitButton(document, 'Sign In…', () => gitDialog(document, {
      title: 'Git Authentication', submitLabel: 'Choose Authentication',
      fields: [{ name: 'remote', label: 'Repository HTTPS URL', type: 'url', required: true,
        value: remotes[0]?.url ?? '' }, { name: 'provider', label: 'Provider',
        options: ['github', 'gitlab', 'bitbucket', 'azure', 'gitea'].map(value => ({ value, label: value })) }],
      onSubmit: values => preferences.signIn(values.remote, values.provider)
    })),
    gitButton(document, 'Add Remote…', () => workbench.remoteDialog(), { disabled: !workbench.repositoryId }));
  element.replaceChildren(actions, view);
}
