import {delay} from '../native-build/settings.js';

/** Browser adapter for the native session API; result records always come from the host's TRX parser. */
export class NativeClientTestAdapter {
  constructor(client) { this.id = 'native-dotnet'; this.client = client; this.sessions = new Set(); this.closed = false; }

  call(operation, request, options) {
    if (this.closed) throw new Error('Native test client is disposed');
    return this.client.service('testing', operation, request, options);
  }

  discover(request, options) { return this.call('discover', request, options); }

  async run(request, {signal, onEvent, onSession, pollMs = 150} = {}) {
    signal?.throwIfAborted();
    const started = await this.call('start', request, {signal});
    this.sessions.add(started.id);
    onSession?.(started);
    let cancelOperation = null;
    let cancellationError = null;
    const cancel = () => {
      cancelOperation ??= this.cancel(started.id).catch(error => { cancellationError = error; });
    };
    signal?.addEventListener('abort', cancel, {once: true});
    if (signal?.aborted) cancel();
    let cursor = 0;
    const deadline = performance.now() + (request.timeoutMs ?? 900000) + 30000;
    try {
      while (!this.closed) {
        if (cancellationError) throw cancellationError;
        const snapshot = await this.call('snapshot', {id: started.id, after: cursor});
        for (const event of snapshot.events ?? []) if (event.sequence > cursor) onEvent?.(event);
        cursor = snapshot.nextCursor;
        if (snapshot.result) return snapshot.result;
        if (performance.now() > deadline) {
          await this.cancel(started.id);
          throw new Error('Native test result polling exceeded its time limit');
        }
        await delay(pollMs);
      }
      throw new Error('Native test client was disposed during the run');
    } finally {
      signal?.removeEventListener('abort', cancel);
      this.sessions.delete(started.id);
      if (cancelOperation) await cancelOperation;
    }
  }

  cancel(id) { return this.call('cancel', {id}); }
  snapshot(id, after = 0) { return this.call('snapshot', {id, after}); }

  async artifact(id, path) {
    const report = await this.call('artifact', {id, path});
    if (report.path !== path || typeof report.base64 !== 'string' || report.base64.length > 48 * 1024 * 1024) {
      throw new Error('Invalid native test artifact response');
    }
    const parts = [];
    for (let start = 0; start < report.base64.length; start += 131072) {
      const decoded = atob(report.base64.slice(start, start + 131072));
      parts.push(Uint8Array.from(decoded, value => value.charCodeAt(0)));
      if (start + 131072 < report.base64.length) await delay(0);
    }
    return new Uint8Array(await new Blob(parts).arrayBuffer());
  }

  async close() {
    await Promise.all([...this.sessions].map(id => this.cancel(id)));
    this.closed = true;
  }
}
