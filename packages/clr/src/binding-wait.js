import { loadError, LoadErrorCode } from './load-errors.js';

/** Cancel one consumer, keep observing the context-owned bind, and remove its abort listener on every outcome. */
export function awaitContextBinding(binding, signal) {
  if (!signal || typeof signal.addEventListener !== 'function') return binding;
  return new Promise((resolve, reject) => {
    let waiting = true;
    const finish = (callback, value) => {
      if (!waiting) return;
      waiting = false;
      signal.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => finish(reject, loadError(LoadErrorCode.Cancelled, 'Assembly operation cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    binding.then(value => finish(resolve, value), error => finish(reject, error));
    if (signal.aborted) abort();
  });
}
