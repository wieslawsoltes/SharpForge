import { GitError } from './errors.js';
import { checkedScopes, credentialScopeEvidence } from './auth/scope-evidence.js';

const requirements = Object.freeze({
  github: { push: ['repo', 'public_repo', 'contents:write'], pullRequest: ['repo', 'public_repo', 'pull_requests:write'],
    issue: ['repo', 'public_repo', 'issues:write'] },
  gitlab: { push: ['api', 'write_repository'], pullRequest: ['api'], issue: ['api'] },
  bitbucket: { push: ['repository:write', 'pullrequest:write', 'write:repository:bitbucket'],
    pullRequest: ['pullrequest:write', 'write:pullrequest:bitbucket'], issue: ['issue:write', 'write:issue:bitbucket'] },
  azure: { push: ['vso.code_write', 'vso.code_manage', 'vso.code_full'],
    pullRequest: ['vso.code_write', 'vso.code_manage', 'vso.code_full'], issue: ['vso.work_write', 'vso.work_full'] },
  gitea: { push: ['write:repository', 'all'], pullRequest: ['write:repository', 'all'], issue: ['write:issue', 'all'] }
});

/** Read server-confirmed OAuth scopes; missing headers never imply write permission. */
export function scopesFromHeaders(headers) {
  return [...new Set(String(new Headers(headers).get('x-oauth-scopes') ?? '').split(/[ ,]+/).filter(Boolean))].sort();
}

export function permissionStatus(credential, operation) {
  const alternatives = requirements[credential.provider]?.[operation];
  if (!alternatives) throw new GitError('Unsupported', 'Unknown provider write operation');
  const evidence = credentialScopeEvidence(credential);
  const scopes = new Set(checkedScopes(credential.scopes));
  if (credential.provider === 'azure' && credential.kind === 'oauth') {
    // Entra returns resource-qualified scopes; only Azure DevOps' documented resource is accepted.
    const prefixes = ['499b84ac-1321-427f-aa17-267ca6975798/', 'https://app.vssps.visualstudio.com/'];
    for (const scope of scopes) {
      for (const prefix of prefixes) if (scope.startsWith(prefix)) scopes.add(scope.slice(prefix.length));
    }
    if (scopes.has('user_impersonation')) scopes.add(alternatives[0]);
  }
  for (const [name, level] of Object.entries(credential.permissions ?? {})) if (level === 'write') scopes.add(`${name}:write`);
  const allowed = evidence.scopeState === 'known' && alternatives.some(value => scopes.has(value));
  const state = evidence.scopeState === 'unknown' ? 'unknown' : allowed ? 'known-sufficient' : 'known-insufficient';
  return Object.freeze({ allowed, state, ...evidence, operation, scopes: [...scopes].sort(),
    missingScopes: allowed ? [] : [...alternatives] });
}

/** Unknown scopes require an explicit request-local acknowledgment; known insufficient scopes always block writes. */
export class GitPermissions {
  constructor({ confirm } = {}) { this.confirm = confirm; }

  async assertWrite(credential, operation, { remote, description, signal } = {}) {
    const status = permissionStatus(credential, operation);
    if (status.state === 'known-insufficient') throw new GitError('Auth', 'Token does not grant the required write permission', status);
    if (signal?.aborted) throw new GitError('Cancelled', 'Write confirmation cancelled');
    const accepted = await this.confirm?.({ ...status, remote, description, signal });
    const confirmed = accepted === true || accepted?.confirmed === true;
    if (!confirmed || (status.state === 'unknown' && accepted?.allowUnverified !== true)) {
      throw new GitError('Auth', status.state === 'unknown' ?
        'Token permissions are unknown; this write requires explicit acknowledgment' : 'Git write has not been confirmed', status);
    }
    if (signal?.aborted) throw new GitError('Cancelled', 'Write confirmation cancelled');
    return { ...status, writeConfirmed: true, unverifiedAttempt: status.state === 'unknown' };
  }
}
