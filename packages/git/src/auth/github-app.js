import { GitError } from '../errors.js';
import { oauthCredential } from './oauth-http.js';

/** User-to-server GitHub App sessions; installation access stays limited to the selected installation. */
export class GitHubAppSession {
  #installation = null;
  constructor({ client, lifecycle, credentialId, broker, allowedOrigins, now = Date.now }) {
    Object.assign(this, { client, lifecycle, credentialId, broker, allowedOrigins, now });
  }

  listInstallations({ signal } = {}) {
    return this.client.paginate('user/installations?per_page=100', { signal, select: value => value.installations });
  }

  async selectInstallation(id, { signal } = {}) {
    const installations = await this.listInstallations({ signal });
    const installation = installations.find(value => value.id === Number(id));
    if (!installation || installation.suspended_at) throw new GitError('Auth', 'Installation is unavailable or revoked');
    this.#installation = installation.id;
    return { id: installation.id, account: installation.account?.login, repositorySelection: installation.repository_selection };
  }

  async listRepositories({ signal } = {}) {
    if (!this.#installation) throw new GitError('Auth', 'Select a GitHub App installation');
    try {
      return await this.lifecycle.run(this.credentialId, (_, request) => this.client.paginate(
        `user/installations/${this.#installation}/repositories?per_page=100`, { signal: request.signal, select: value => value.repositories }
      ), { signal });
    } catch (error) {
      if ([401, 403, 404].includes(error?.details?.status)) throw new GitError('Auth', 'Installation authorization has been revoked');
      throw error;
    }
  }

  providerHandlers() {
    return {
      refresh: async (credential, { signal }) => oauthCredential(
        await this.broker.refresh({ refreshToken: credential.refreshToken, signal }),
        { provider: 'github', allowedOrigins: credential.allowedOrigins, now: this.now() }
      ),
      revoke: credential => this.broker.revoke({ accessToken: credential.accessToken })
    };
  }

  async logout() { this.#installation = null; await this.lifecycle.logout(this.credentialId); }
  toJSON() { return { installationId: this.#installation }; }
}
