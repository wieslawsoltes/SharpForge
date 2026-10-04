import {parentPort} from 'node:worker_threads';

// This dependency initializes the browser transport before the statically imported production entry is evaluated.
globalThis.self = {postMessage: value => parentPort.postMessage(value)};
