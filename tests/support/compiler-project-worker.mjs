import {parentPort} from 'node:worker_threads';

// Adapt only the browser message transport; execute the production compiler entry unchanged.
globalThis.self = {postMessage: value => parentPort.postMessage(value)};
await import('../../apps/studio/compiler.worker.js');
parentPort.on('message', data => self.onmessage({data}));
