import './compiler-worker-transport.mjs';
import '../../apps/studio/compiler.worker.js';
import {parentPort} from 'node:worker_threads';

parentPort.on('message', data => self.onmessage({data}));
