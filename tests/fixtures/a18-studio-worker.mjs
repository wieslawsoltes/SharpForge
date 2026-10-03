import {parentPort} from 'node:worker_threads';

// The production worker receives only a Node transport adapter; its compiler and registered handlers are unchanged.
globalThis.self = {postMessage: message => parentPort.postMessage(message)};
await import('../../apps/studio/compiler.worker.js');
parentPort.on('message', data => self.onmessage({data}));
parentPort.postMessage({ready: true});
