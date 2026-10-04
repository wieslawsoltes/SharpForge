import { GitError } from '@sharpforge/git';

/** Bind OAuth completion to the exact popup WindowProxy, callback origin, path and in-memory state. */
export async function authorizeGitPopup({ flow, window = globalThis.window, signal, timeoutMs = 600000, prepare } = {}) {
  const popup = window.open('about:blank', 'sharpforge-git-sign-in', 'popup,width=620,height=760');
  if (!popup) throw new GitError('Auth', 'Allow the sign-in popup and try again');
  let transaction;
  try { await prepare?.(); transaction = await flow.start({ signal }); }
  catch (error) { popup.close(); throw error; }
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      window.removeEventListener('message', message);
      flow.cancel(transaction.state);
      popup.close();
    };
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      cleanup();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new GitError('Cancelled', 'Sign in cancelled'));
    const message = async event => {
      if (event.source !== popup || event.origin !== window.location.origin || event.data?.type !== 'sharpforge.git.oauth.callback') return;
      try { finish(null, await flow.complete(event.data.callbackUrl, { signal })); }
      catch (error) { finish(error); }
    };
    const timer = setTimeout(() => finish(new GitError('Auth', 'Sign in expired')), timeoutMs);
    window.addEventListener('message', message);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    popup.location.href = transaction.authorizationUrl;
  });
}
