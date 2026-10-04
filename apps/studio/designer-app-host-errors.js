/** Stable app-host diagnostics. Source files and worker details are never logged implicitly. */
export class DesignerAppHostError extends Error {
  constructor(message, code = 'SFDA0001', details = {}) {
    super(message);
    this.name = 'DesignerAppHostError';
    this.code = code;
    this.source = 'Designer';
    Object.assign(this, details);
  }
}

export function assertAppSignal(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('App operation canceled', 'AbortError');
}

/** Await a cooperative operation with a bounded deadline and release every cancellation listener. */
export function awaitAppOperation(task, {signal, timeout = 30_000} = {}) {
  assertAppSignal(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', canceled);
      callback(value);
    };
    const canceled = () => finish(reject, signal.reason ?? new DOMException('App operation canceled', 'AbortError'));
    const timer = setTimeout(() => finish(reject, new DesignerAppHostError('App operation timed out', 'SFDA0004')), timeout);
    signal?.addEventListener('abort', canceled, {once: true});
    Promise.resolve().then(() => settled ? undefined : task()).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

export function releaseAppResources(actions) {
  const errors = [];
  for (const action of actions) {
    try { action(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Some app resources could not be released');
}
