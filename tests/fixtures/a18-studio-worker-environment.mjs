import {parentPort} from 'node:worker_threads';

// Set up this isolated worker's transport before evaluating the unchanged production worker module.
globalThis.self = {postMessage: message => parentPort.postMessage(message)};
