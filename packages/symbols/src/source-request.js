import { SourceStatus, sourceFailure } from './source-status.js';

/** One abort lifetime covers permission, transport, streaming and validation. */
export function sourceRequest(signal, timeoutMs, reportCleanupError) {
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const timeout = () => controller.abort(sourceFailure(SourceStatus.timeout, 'Source request timed out'));
  const check = () => {
    if (!controller.signal.aborted && Date.now() >= deadline) timeout();
    if (controller.signal.aborted) throw controller.signal.reason;
  };
  const cancel = () => controller.abort(sourceFailure(SourceStatus.cancelled, 'Source request cancelled'));
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(timeout, timeoutMs);
  return {
    signal: controller.signal,
    check,
    abort() {
      controller.abort(sourceFailure(SourceStatus.disposed, 'Source client disposed'));
    },
    wait(action, onAbortedValue) {
      check();
      return new Promise((resolve, reject) => {
        const aborted = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', aborted, { once: true });
        Promise.resolve()
          .then(() => {
            check();
            return action();
          })
          .then((value) => {
            if (controller.signal.aborted) {
              try {
                onAbortedValue?.(value);
              } catch (error) {
                reportCleanupError(error);
              }
              reject(controller.signal.reason);
            } else resolve(value);
          }, reject)
          .finally(() => {
            controller.signal.removeEventListener('abort', aborted);
          });
      });
    },
    cancelBody(body) {
      if (!body) return;
      try {
        Promise.resolve(body.cancel(controller.signal.reason)).catch(reportCleanupError);
      } catch (error) {
        reportCleanupError(error);
      }
    },
    close() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    },
  };
}

export async function sourceResponseBytes(response, operation, maxBytes) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    operation.cancelBody(response.body);
    throw sourceFailure(SourceStatus.tooLarge, 'Source response exceeds byte limit');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  let chunkCount = 0;
  let completed = false;
  try {
    while (true) {
      const part = await operation.wait(() => reader.read());
      if (part.done) {
        completed = true;
        break;
      }
      if (++chunkCount > 65536) throw sourceFailure(SourceStatus.tooLarge, 'Source stream chunk limit exceeded');
      if (!(part.value instanceof Uint8Array)) throw sourceFailure(SourceStatus.networkError, 'Non-byte source stream');
      length += part.value.length;
      if (length > maxBytes) throw sourceFailure(SourceStatus.tooLarge, 'Source response exceeds byte limit');
      if (part.value.length) chunks.push(new Uint8Array(part.value));
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } finally {
    // Cancellation may be implemented by an uncooperative injected transport;
    // cleanup must never hold the bounded request open waiting for that promise.
    if (!completed) operation.cancelBody(reader);
    reader.releaseLock();
  }
}
