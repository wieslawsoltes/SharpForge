import { serializeRoutedEvent } from '../input/transport.js';

function abortError(message = 'UI event request was canceled') {
  return Object.assign(new Error(message), { name: 'AbortError', code: 'SFUI1675' });
}

/** Root-owned, bounded event acknowledgements keep cancellation and deferrals inside the initiating lifetime. */
export class HostEventRequests {
  constructor(host, { maximumPending = 64, timeout = 30000 } = {}) {
    this.host = host;
    this.maximumPending = maximumPending;
    this.timeout = timeout;
    this.pending = new Set();
    this.disposed = false;
  }

  async request(id, event, payload, { signal } = {}) {
    if (this.disposed || this.host.disposed || signal?.aborted) throw abortError();
    if (typeof id !== 'string' || !this.host.nodes.has(id) || typeof event !== 'string'
      || !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(event)) throw new TypeError('SFUI1675: Invalid UI event request');
    const data = serializeRoutedEvent(payload);
    if (typeof this.host.options.onEventRequest !== 'function') {
      this.host.emit(this.host.nodes.get(id), event, data);
      return data;
    }
    if (this.pending.size >= this.maximumPending) throw new RangeError('SFUI1675: Pending UI event request limit');
    const controller = new AbortController();
    const entry = { id, controller };
    const abort = () => controller.abort(signal?.reason ?? abortError());
    signal?.addEventListener('abort', abort, { once: true });
    this.pending.add(entry);
    let timer;
    let canceled;
    try {
      const cancellation = new Promise((_, reject) => {
        canceled = () => reject(controller.signal.reason ?? abortError());
        controller.signal.addEventListener('abort', canceled, { once: true });
        timer = setTimeout(() => controller.abort(abortError('UI event request exceeded 30 seconds')), this.timeout);
      });
      const operation = this.host.options.onEventRequest(id, event, data, { signal: controller.signal });
      const result = await Promise.race([operation, cancellation]);
      return result == null ? data : serializeRoutedEvent(result);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', canceled);
      this.pending.delete(entry);
    }
  }

  cancelTarget(id) {
    for (const entry of this.pending) if (entry.id === id) entry.controller.abort(abortError('UI event target was removed'));
  }
  clear() { for (const entry of this.pending) entry.controller.abort(abortError('UI event root was reset')); }
  dispose() { this.disposed = true; this.clear(); }
}
