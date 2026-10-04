import {createTestWorkerService} from './worker-service.js';

const service = createTestWorkerService({postMessage: message => self.postMessage(message)});
self.onmessage = event => { void service.receive(event.data); };
