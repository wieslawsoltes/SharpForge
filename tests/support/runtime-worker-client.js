import {Worker} from 'node:worker_threads';

/** Exercise the production worker with only its postMessage transport adapted to Node. */
export function runtimeWorkerClient(test) {
  const worker = new Worker(new URL('./runtime-project-worker.mjs', import.meta.url), {type: 'module'});
  const pending = new Map();
  const waiters = new Set();
  const events = [];
  let serial = 0;
  const settle = (entry, value, failed = false) => {
    clearTimeout(entry.timer);
    if (failed) entry.reject(value);
    else entry.resolve(value);
  };
  worker.on('message', message => {
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      settle(request, message.error ? Object.assign(new Error(message.error.message), message.error) : message.result, !!message.error);
      return;
    }
    events.push(message);
    for (const waiter of waiters) {
      if (!waiter.predicate(message)) continue;
      waiters.delete(waiter);
      settle(waiter, message);
    }
  });
  const fail = error => {
    for (const request of pending.values()) settle(request, error, true);
    for (const waiter of waiters) settle(waiter, error, true);
    pending.clear();
    waiters.clear();
  };
  worker.on('error', fail);
  test.after(async () => {
    await worker.terminate();
    fail(new Error('Worker closed'));
  });
  function wait(predicate) {
    const existing = events.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const entry = {predicate, resolve, reject};
      entry.timer = setTimeout(() => {
        waiters.delete(entry);
        reject(new Error('Worker event timeout: ' + JSON.stringify(events.slice(-3))));
      }, 10000);
      waiters.add(entry);
    });
  }
  function request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Worker request timeout: ' + method));
      }, 10000);
      pending.set(id, {resolve, reject, timer});
      worker.postMessage({id, method, params});
    });
  }
  return {events, wait, request, ready: () => wait(message => message.event === 'ready')};
}
