import { GitError } from '../errors.js';
import { encodeBase64, secureUrl, tokenText } from './security.js';
import { checkedScopes } from './scope-evidence.js';

/** Build credential-bound authorization. A mismatched host always fails before network I/O. */
export function credentialAuthorization(credential, input, { purpose = 'api' } = {}) {
  const url = secureUrl(input, { protocols: ['https:'] });
  if (!credential?.allowedOrigins?.includes(url.origin)) {
    throw new GitError('Auth', 'Credential does not authorize the requested origin', { origin: url.origin });
  }
  const token = tokenText(credential.accessToken);
  const basicUsers = { github: 'x-access-token', gitlab: 'oauth2', azure: '' };
  const useBasic = credential.scheme === 'Basic' || (credential.provider === 'azure' && credential.kind === 'pat') ||
    (purpose === 'git' && credential.provider !== 'azure' && Object.hasOwn(basicUsers, credential.provider));
  if (!useBasic) return `Bearer ${token}`;
  const username = credential.username ?? basicUsers[credential.provider];
  if (typeof username !== 'string' || username.includes(':') || /[\r\n]/.test(username)) {
    throw new GitError('Auth', 'Basic authentication requires a valid username');
  }
  return `Basic ${encodeBase64(new TextEncoder().encode(`${username}:${token}`))}`;
}

/** Construct a PAT record; token scopes must come from the provider or explicit introspection. */
export function personalAccessCredential({ provider, token, allowedOrigins, username, scopes, permissions }) {
  if (!['github', 'gitlab', 'bitbucket', 'azure', 'gitea'].includes(provider)) {
    throw new GitError('Unsupported', 'Unknown Git credential provider');
  }
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length) {
    throw new GitError('Auth', 'Credential requires an explicit origin binding');
  }
  return {
    provider, accessToken: tokenText(token), username,
    allowedOrigins: allowedOrigins.map(value => {
      const url = secureUrl(value, { protocols: ['https:'] });
      if (url.pathname !== '/' || url.search) throw new GitError('Auth', 'Credential binding must be an exact origin');
      return url.origin;
    }), scopes: checkedScopes(scopes), permissions: { ...permissions }, kind: 'pat', expiresAt: null,
    scopeState: scopes !== undefined || permissions !== undefined ? 'known' : 'unknown',
    scopeSource: scopes !== undefined || permissions !== undefined ? 'provided' : 'none'
  };
}
