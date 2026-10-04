import { GitError } from '../errors.js';

const sources = new Set(['none', 'provided', 'oauth-response', 'oauth-header', 'gitlab-self', 'gitlab-self-granular', 'gitea-current-token']);

/** Validate provider scope metadata without interpreting a requested scope as a granted permission. */
export function checkedScopes(scopes = []) {
  if (!Array.isArray(scopes) || scopes.length > 256 || scopes.some(scope =>
    typeof scope !== 'string' || !scope || scope.length > 1024 || /[\u0000-\u0020\u007f]/.test(scope))) {
    throw new GitError('Auth', 'Invalid credential scopes');
  }
  return [...new Set(scopes)].sort();
}

/** Empty legacy records are unknown; an explicitly observed empty scope set is known and insufficient. */
export function credentialScopeEvidence(credential) {
  const supplied = Boolean(credential.scopes?.length || Object.keys(credential.permissions ?? {}).length);
  const scopeState = credential.scopeState ?? (supplied ? 'known' : 'unknown');
  const scopeSource = credential.scopeSource ?? (supplied ? 'provided' : 'none');
  if (!['known', 'unknown'].includes(scopeState) || !sources.has(scopeSource)) {
    throw new GitError('Auth', 'Invalid credential scope evidence');
  }
  return { scopeState, scopeSource };
}

/** GitHub App and fine-grained PAT permissions are not described by the OAuth scopes header. */
export function acceptsOAuthScopeHeader(credential) {
  return credential.provider !== 'github' || !/^(?:github_pat_|gh[us]_)/.test(credential.accessToken);
}
