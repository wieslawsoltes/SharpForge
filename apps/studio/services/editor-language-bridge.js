/** Adapt only the legacy Studio editor callback; native editor factories own their richer providers. */
export function createStudioEditorBridge(requestLanguage) {
  if (typeof requestLanguage !== 'function') throw new TypeError('Studio language request callback is required');
  const supports = method => method === 'completion' || method === 'hover';

  function dataRequest(method, parameters = {}) {
    // The editor's AbortSignal controls this caller, never the structured-clone worker payload.
    const { signal, ...data } = parameters;
    if (signal?.aborted) return Promise.reject(cancelledRequest(signal));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (failed, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        if (failed) reject(value);
        else resolve(value);
      };
      const abort = () => finish(true, cancelledRequest(signal));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      try {
        // The legacy compiler job may still finish or time out after local cancellation.
        Promise.resolve(requestLanguage(method, data)).then(
          value => finish(false, value),
          error => finish(true, error)
        );
      } catch (error) {
        finish(true, error);
      }
    });
  }

  function request(method, parameters) {
    // A nullish response activates FoldingProvider's lexical scan; [] would suppress it.
    if (method === 'foldingRanges') return null;
    if (supports(method)) return dataRequest(method, parameters);
    return requestLanguage(method, parameters);
  }

  const services = Object.freeze({
    supports,
    async invoke(method, parameters) {
      if (!supports(method)) throw new TypeError(`Studio does not provide editor data for ${method}`);
      return dataRequest(method, parameters);
    }
  });
  return Object.freeze({ request, services });
}

function cancelledRequest(signal) {
  const error = new Error('Studio editor request cancelled', { cause: signal.reason });
  error.name = 'AbortError';
  return error;
}
