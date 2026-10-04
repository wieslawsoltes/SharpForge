import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { GitOriginGrants } from '../origins.js';
import { GitPermissions } from '../permissions.js';
import { SecretRedactor } from '../redact.js';
import { CredentialVault } from './vault.js';
import { CredentialLifecycle } from './lifecycle.js';
import { credentialAuthorization } from './pat.js';
import { createOAuthLifecycleHandlers } from './provider-lifecycle.js';
import { inspectCredential } from './inspection.js';
import { sanitizeArtifact } from './artifacts.js';

export const gitAuthMethods = Object.freeze([
  'setCredential', 'listCredentials', 'logout', 'grant', 'revokeGrant', 'configurePersistence', 'describeGrants',
  'inspectCredential', 'sanitizeArtifact'
]);

/** Request-local consent; the confirmed remote and operation must match the actual write. */
export function scopedWritePermissions({ remoteId, writeConsent } = {}) {
  return new GitPermissions({ confirm: ({ operation }) => {
    if (writeConsent?.confirmed !== true || writeConsent.remoteId !== remoteId || writeConsent.scope !== operation) return false;
    return { confirmed: true, allowUnverified: writeConsent.allowUnverified === true };
  } });
}

/** Worker-owned authentication service. RPC replies contain credential metadata, never token values. */
export function createGitAuthContext(options = {}) {
  const vault = options.vault ?? new CredentialVault(options);
  const grants = options.grants ?? new GitOriginGrants();
  const redactor = options.redactor ?? new SecretRedactor();
  const forget = new Map();
  const remember = (id, credential) => {
    const records = forget.get(id) ?? new Map();
    const identity = `${credential.accessToken}\0${credential.refreshToken ?? ''}`;
    if (records.has(identity)) return;
    checkLimit(records.size + 1, 128, 'Rotated credential count');
    // Retain old token redactions until logout so late job failures cannot disclose a rotated secret.
    records.set(identity, redactor.registerCredential(credential));
    forget.set(id, records);
  };
  const lifecycle = options.lifecycle ?? new CredentialLifecycle({ vault, now: options.now, onCredential: remember });
  if (!options.lifecycle) {
    for (const provider of ['github', 'gitlab', 'bitbucket', 'azure', 'gitea']) {
      lifecycle.registerProvider(provider, createOAuthLifecycleHandlers(provider, { grants, fetch: options.fetch, now: options.now }));
    }
  }
  const methods = {
    async setCredential({ id, credential, remoteId, origins, grantConsent = false }) {
      if (origins) {
        if (!grantConsent) throw new GitError('Unsafe', 'Origin grants require explicit consent');
        grants.grant(remoteId, origins);
      }
      for (const origin of credential.allowedOrigins ?? []) grants.assert(origin, { remoteId });
      remember(id, credential);
      await vault.set(id, credential);
      return (await vault.list()).find(record => record.id === id);
    },
    listCredentials: () => vault.list(),
    inspectCredential: (params, operation) => inspectCredential(params, { lifecycle, vault, grants,
      fetch: operation.fetch ?? options.fetch, signal: operation.signal }),
    sanitizeArtifact: (artifact, operation) => sanitizeArtifact(artifact, redactor, operation),
    async logout({ id }) {
      let result;
      try { result = await lifecycle.logout(id); }
      finally {
        for (const dispose of forget.get(id)?.values() ?? []) dispose();
        forget.delete(id);
      }
      return { id, loggedOut: true, ...result };
    },
    grant({ remoteId, origins, consent = false }) {
      if (!consent) throw new GitError('Unsafe', 'Origin grants require explicit consent');
      return { remoteId, origins: grants.grant(remoteId, origins), csp: grants.createCsp() };
    },
    revokeGrant({ remoteId, origin }) {
      grants.revoke(remoteId, origin);
      return { remoteId, origins: grants.list(remoteId), csp: grants.createCsp() };
    },
    async configurePersistence({ mode, consent = false }) {
      if (mode === 'encrypted') await vault.enablePersistence({ consent });
      else if (mode === 'session') await vault.disablePersistence();
      else throw new GitError('Unsafe', 'Unknown credential persistence mode');
      return { mode: vault.mode };
    },
    describeGrants: () => ({ grants: grants.describe(), csp: grants.createCsp() })
  };

  return {
    vault, grants, lifecycle, redactor,
    async invoke(method, params = {}, { signal, fetch } = {}) {
      checkCancelled(signal);
      const action = methods[method];
      if (!Object.hasOwn(methods, method)) throw new GitError('Unsupported', 'Unknown authentication operation');
      const result = await action(params, { signal, fetch });
      checkCancelled(signal);
      return method === 'sanitizeArtifact' ? result : redactor.value(result);
    },
    providerOptions({ remoteId, credentialId, writeConsent }) {
      const sessionSignal = credentialId ? lifecycle.signalFor(credentialId) : undefined;
      return { grants, remoteId, permissions: scopedWritePermissions({ remoteId, writeConsent }),
        credentialProvider: () => credentialId ? lifecycle.credential(credentialId) : null,
        sessionSignal, onScopes: (scopes, { accessToken } = {}) => credentialId ?
          lifecycle.observeScopes(credentialId, scopes, { sessionSignal, accessToken }) : undefined };
    },
    async transportOptions({ remoteId, credentialId, credentialForwardOrigins = [], credentialForwardConsent = false,
      actionCredentialOrigins = [], actionCredentialConsent = false }) {
      const credential = credentialId ? await lifecycle.credential(credentialId) : null;
      const sessionSignal = credentialId ? lifecycle.signalFor(credentialId) : undefined;
      return {
        origins: grants.list(remoteId), credentialOrigins: credential?.allowedOrigins ?? [],
        sessionSignal,
        requireOrigin: async (origin, { credentials = false, purpose } = {}) => {
          const url = grants.assert(origin, { remoteId, protocols: ['https:'] });
          if (!credentials) return true;
          if (purpose === 'git-lfs-action-credentials') {
            if (!actionCredentialConsent || !actionCredentialOrigins.includes(url.origin)) {
              throw new GitError('Auth', 'LFS action credential recipient requires separate explicit consent', {
                origin: url.origin, purpose: 'git-lfs-action-credentials', credentials: true
              });
            }
            return true;
          }
          if (!credentialId) throw new GitError('Auth', 'Credential origin was requested without a credential');
          if (purpose === 'git-proxy-credentials') {
            if (!credentialForwardConsent || !credentialForwardOrigins.includes(url.origin)) {
              throw new GitError('Auth', 'Forwarding credentials to the proxy requires separate explicit consent', { origin: url.origin });
            }
            return true;
          }
          const record = await lifecycle.credential(credentialId);
          if (!record.allowedOrigins.includes(url.origin)) throw new GitError('Auth', 'Credential origin binding does not match');
          return true;
        },
        ...(credentialId ? { credentialProvider: async ({ url }) => {
          grants.assert(url, { remoteId, protocols: ['https:'] });
          const record = await lifecycle.credential(credentialId);
          return { headers: { Authorization: credentialAuthorization(record, url, { purpose: 'git' }) } };
        } } : {}),
        onScopes: scopes => credentialId ?
          lifecycle.observeScopes(credentialId, scopes, { sessionSignal, accessToken: credential.accessToken }) : undefined
      };
    },
    async dispose() {
      await lifecycle.dispose();
      for (const records of forget.values()) for (const dispose of records.values()) dispose();
      forget.clear();
      redactor.clear();
      await vault.dispose();
    }
  };
}
