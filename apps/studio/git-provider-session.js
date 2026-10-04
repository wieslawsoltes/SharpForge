import { GitError, checkCancelled, requiredGitOrigins } from '@sharpforge/git';

const providers = new Set(['github', 'gitlab', 'bitbucket', 'azure', 'gitea']);

/** Closed repository identity for provider UI actions; credentials never appear in its URL. */
export function providerTarget(remote, provider) {
  let url;
  try { url = new URL(typeof remote === 'string' ? remote : remote?.url); }
  catch { throw new GitError('Unsafe', 'Enter a repository HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !providers.has(provider)) {
    throw new GitError('Unsafe', 'Select a provider and a repository HTTPS URL without credentials or query parameters');
  }
  return { remote: url.href, remoteId: url.origin, provider };
}

/** Account metadata is filtered to the selected service and its exact credential recipient origins. */
export async function providerAccounts(workbench, target, options = {}) {
  const origins = requiredGitOrigins(target.remote, { provider: target.provider });
  return (await workbench.preferences.auth('listCredentials', {}, options)).filter(record => record.provider === target.provider &&
    record.allowedOrigins?.some(origin => origins.includes(origin)));
}

export function selectedProviderAccount(workbench, target, accounts, requestedId) {
  const selected = requestedId ?? workbench.credentialIds.get(target.remoteId) ??
    accounts.find(record => record.id === target.remoteId)?.id;
  if (selected === '') return undefined;
  if (selected !== undefined) {
    if (!accounts.some(record => record.id === selected)) throw new GitError('Auth', 'The selected account is unavailable for this provider');
    return selected;
  }
  return accounts.length === 1 ? accounts[0].id : undefined;
}

/** Grant first, then resolve a currently available account. Writes add consent only at the submit action. */
export async function authorizeProviderTarget(workbench, target, requestedId, options = {}) {
  checkCancelled(options.signal);
  const identity = providerTarget(target.remote, target.provider);
  await workbench.preferences.grant(identity.remote, identity.provider);
  checkCancelled(options.signal);
  const accounts = await providerAccounts(workbench, identity, options);
  checkCancelled(options.signal);
  const credentialId = selectedProviderAccount(workbench, identity, accounts, requestedId);
  return { ...identity, credentialId };
}
