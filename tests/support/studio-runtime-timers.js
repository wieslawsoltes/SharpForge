import { Worker } from 'node:worker_threads';
import { createWorkbenchServices } from '../../apps/studio/workbench/sessions.js';
import { DiagnosticTimeline } from '../../apps/studio/workbench/tools/diagnostic-timeline-model.js';
import { ExecutionCapture } from '../../apps/studio/workbench/tools/execution-capture.js';
import { browserGlobalTimers } from './browser-global-timers.js';

/** Real production worker and AppSession, with browser receiver checks on both sides of its Node transport. */
export function runtimeTimerWorkbench(context) {
  const timerMethods = browserGlobalTimers();
  context.mock.method(globalThis, 'setTimeout', timerMethods.setTimeout);
  context.mock.method(globalThis, 'clearTimeout', timerMethods.clearTimeout);
  const transports = [];
  const workerFactory = () => {
    const worker = new Worker(new URL('../fixtures/a19/runtime-worker-browser-timers.js', import.meta.url), { type: 'module' });
    const transport = {
      disposed: false,
      postMessage(message, transfer) { worker.postMessage(message, transfer); },
      terminate() {
        if (!this.disposed) { this.disposed = true; this.termination = worker.terminate(); }
        return this.termination;
      }
    };
    worker.on('message', data => transport.onmessage?.({ data }));
    worker.on('error', error => transport.onerror?.({ error, message: error.message }));
    transports.push(transport);
    return transport;
  };
  const errors = [];
  const events = [];
  const services = createWorkbenchServices({ workerFactory, onError: error => errors.push(error),
    onSessionEvent: event => events.push({ type: event.type, appId: event.appId, identity: event.identity }) });
  const state = services.createStateFacade({ debug: null, programOutput: '' });
  const timeline = new DiagnosticTimeline();
  const capture = new ExecutionCapture({ sessions: services.sessions, model: timeline, intervalMs: 100,
    onError: error => errors.push(error) });
  capture.start();
  context.after(async () => {
    capture.dispose();
    services.dispose();
    timeline.dispose();
    await Promise.all(transports.map(transport => transport.terminate()));
  });
  return { services, state, timeline, capture, errors, events };
}

/** Wait on actual routed events with the existing worker-test deadline; no polling or synthesized runtime state. */
export function waitForEvent(source, read, description) {
  const current = read();
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const finish = (error, result) => {
      remove();
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const remove = source.subscribe(() => {
      const result = read();
      if (result) finish(null, result);
    });
    const timer = setTimeout(() => finish(new Error('Runtime event timeout: ' + description)), 10_000);
  });
}

export function waitForRuntimeState(session, expected) {
  return waitForEvent(session, () => session.debug?.state === expected ? session.debug : null, expected);
}
