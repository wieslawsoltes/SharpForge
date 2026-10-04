import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('The runtime worker fixture requires a Node worker thread');

// This dependency evaluates before the production worker's static import and installs only its browser transport.
const workerScope = { postMessage: value => parentPort.postMessage(value) };
globalThis.self = workerScope;

/** Forward messages only after the statically imported production worker has installed its request handler. */
export function connectRuntimeWorkerPort() {
  if (typeof workerScope.onmessage !== 'function') throw new Error('The production runtime worker did not initialize');
  parentPort.on('message', data => workerScope.onmessage({ data }));
  parentPort.postMessage({ event: 'ready' });
}
