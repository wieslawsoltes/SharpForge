export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

export class FakeWorker {
  constructor(url, options, respond) {
    this.url = String(url);
    this.options = options;
    this.respond = respond;
    this.requests = [];
    this.terminated = false;
    this.serial = 0;
  }

  postMessage(message) {
    if (this.terminated) throw new Error('Worker is terminated');
    this.requests.push(message);
    if (!this.respond) return;
    Promise.resolve().then(() => this.respond(message, this)).then(result => {
      if (result !== undefined) this.reply(message.id, result);
    }, error => this.reply(message.id, null, error));
  }

  reply(id, result, error) {
    this.onmessage?.({ data: error ? { id, error: { name: error.name, message: error.message, code: error.code } } : { id, result } });
  }

  emit(event) { this.onmessage?.({ data: event }); }
  terminate() { this.terminated = true; }
}

export function fakeWorkers(respond) {
  const workers = [];
  const factory = (url, options) => {
    const worker = new FakeWorker(url, options, respond);
    workers.push(worker);
    return worker;
  };
  return { workers, factory };
}

export function fakeRuntime(message, worker) {
  if (message.method === 'launch') {
    const sessionId = ++worker.serial;
    worker.emit({ event: 'loaded', sessionId, sources: [{ uri: 'Program.cs', text: 'source' }] });
    worker.emit({ event: 'state', sessionId, state: 'running', output: '', frames: [], threads: [], stats: {} });
    return { started: true, sessionId };
  }
  if (message.method === 'stop') {
    worker.emit({ event: 'state', sessionId: worker.serial, state: 'terminated', output: '', frames: [], stats: {} });
    return { stopped: true };
  }
  return { ok: true };
}

export function compileResult(success = true) {
  return {
    success, image: success ? { name: 'Example', methods: [] } : null,
    assembly: success ? new Uint8Array([77, 90, 1]) : null,
    diagnostics: success ? [] : [{ message: 'Compiler failure', code: 'SFTEST', severity: 'error', uri: 'Program.cs', start: 0 }],
    metrics: { errors: success ? 0 : 1 }
  };
}

export const settle = () => new Promise(resolve => setImmediate(resolve));
