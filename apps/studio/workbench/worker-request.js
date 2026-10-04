/** One cancellable, bounded worker operation; completion, error, timeout and disposal terminate the owned worker. */
export function workerRequest(payload, {createWorker, signal, timeoutMs = 5000, onProgress = () => {}}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(signal.reason ?? new DOMException('Operation cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Workspace operation exceeded ' + timeoutMs + ' ms and was stopped')), timeoutMs);
    signal?.addEventListener('abort', abort, {once: true});
    worker.onmessage = event => {
      const message = event.data;
      if (message.type === 'progress') onProgress(message.progress);
      if (message.type === 'error') finish(Object.assign(new Error(message.error.message), {name: message.error.name, code: message.error.code}));
      if (message.type === 'result') finish(null, message.result);
    };
    worker.onerror = event => finish(new Error(event.message ?? 'Workspace worker failed'));
    try { worker.postMessage(payload); }
    catch (error) { finish(error); }
  });
}
