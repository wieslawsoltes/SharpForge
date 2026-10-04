import {parentPort} from 'node:worker_threads';

globalThis.self = {postMessage: value => parentPort.postMessage(value)};
await import('../../apps/studio/runtime.worker.js');
parentPort.on('message', data => self.onmessage({data}));
parentPort.postMessage({event: 'ready'});
