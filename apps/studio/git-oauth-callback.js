/** Forward the one-use callback to its same-origin opener, then remove it from browser history. */
export function completeGitOAuthCallback({ window = globalThis.window, document = globalThis.document } = {}) {
  const callbackUrl = window.location.href;
  const url = new URL(callbackUrl);
  const state = url.searchParams.get('state');
  const status = document.getElementById('git-auth-status');
  window.history.replaceState(null, '', `${url.pathname}`);
  if (!window.opener || !state || url.searchParams.getAll('state').length !== 1) {
    status.textContent = 'The sign-in window is unavailable. Return to the IDE and start sign in again.';
    return false;
  }
  window.opener.postMessage({ type: 'sharpforge.git.oauth.callback', callbackUrl }, url.origin);
  status.textContent = 'Authorization returned to the IDE. You may close this window.';
  return true;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') completeGitOAuthCallback();
