import {Worker} from 'node:worker_threads';
import {AppSession} from '../../apps/studio/workbench/app-session.js';
import {OutputChannels} from '../../apps/studio/workbench/output-channels.js';

/** Real runtime.worker.js and AppSession; only the Node/browser message transport is adapted. */
export function studioRuntimeSession(test, {id = 'application'} = {}) {
  const workers = [], events = [], listeners = new Set(), errors = [];
  const output = new OutputChannels();
  const session = new AppSession({id, projectId: 'binding-fixture', name: id}, {output, onError: error => errors.push(error),
    workerFactory: () => {
      const worker = new Worker(new URL('../fixtures/a19/runtime-worker-node.js', import.meta.url), {type: 'module'});
      const adapter = {postMessage: (value, transfer) => worker.postMessage(value, transfer),
        terminate() { return adapter.ended ??= worker.terminate(); }};
      worker.on('message', data => adapter.onmessage?.({data}));
      worker.on('error', error => adapter.onerror?.({message: error.message, error}));
      workers.push(adapter);
      return adapter;
    }});
  const unsubscribe = session.worker.subscribe(envelope => {
    if (envelope.type !== 'event') return;
    const value = envelope.event;
    events.push(value);
    if (events.length > 512) events.shift();
    for (const listener of [...listeners]) if (listener.predicate(value)) {
      clearTimeout(listener.timer); listeners.delete(listener); listener.resolve(value);
    }
  });
  function wait(predicate) {
    const prior = events.find(predicate);
    if (prior) return Promise.resolve(prior);
    return new Promise((resolve, reject) => {
      const listener = {predicate, resolve, reject, timer: null};
      listener.timer = setTimeout(() => { listeners.delete(listener); reject(new Error('Studio runtime fixture event timeout')); }, 10000);
      listeners.add(listener);
    });
  }
  test.after(async () => {
    unsubscribe(); session.dispose(); output.dispose();
    for (const listener of listeners) { clearTimeout(listener.timer); listener.reject(new Error('Runtime fixture disposed')); }
    listeners.clear();
    await Promise.all(workers.map(worker => worker.terminate()));
  });
  return {session, output, events, errors, wait, clear: () => { events.length = 0; }};
}
