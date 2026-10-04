import { Worker } from 'node:worker_threads';

/** Execute the real worker module with only its browser transport adapted to Node. */
export function connectRuntimeWorker(test) {
  const worker = new Worker(new URL('./fixtures/a19/runtime-worker-node.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  const subscribers = new Set();
  const events = [];
  let serial = 0;

  function rejectAll(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    for (const subscriber of subscribers) {
      clearTimeout(subscriber.timer);
      subscriber.reject(error);
    }
    subscribers.clear();
  }

  worker.on('error', rejectAll);
  worker.on('message', message => {
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(Object.assign(new Error(message.error.message), message.error));
      else request.resolve(message.result);
      return;
    }
    events.push(message);
    if (events.length > 512) events.shift();
    for (const subscriber of subscribers) {
      if (!subscriber.predicate(message)) continue;
      subscribers.delete(subscriber);
      clearTimeout(subscriber.timer);
      subscriber.resolve(message);
    }
  });

  test.after(async () => {
    rejectAll(new Error('Test worker disposed'));
    await worker.terminate();
  });

  function wait(predicate) {
    const event = events.find(predicate);
    if (event) return Promise.resolve(event);
    return new Promise((resolve, reject) => {
      const subscriber = { predicate, resolve, reject, timer: null };
      subscriber.timer = setTimeout(() => {
        subscribers.delete(subscriber);
        reject(new Error('Runtime event timeout'));
      }, 10_000);
      subscribers.add(subscriber);
    });
  }

  function request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Runtime request timeout: ' + method));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, method, params });
    });
  }

  return { request, wait, ready: () => wait(event => event.event === 'ready'), clear: () => { events.length = 0; } };
}
