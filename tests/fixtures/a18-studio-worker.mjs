import './a18-studio-worker-environment.mjs';
import '../../apps/studio/compiler.worker.js';
import {parentPort} from 'node:worker_threads';

parentPort.on('message', data => self.onmessage({data}));
parentPort.postMessage({ready: true});
