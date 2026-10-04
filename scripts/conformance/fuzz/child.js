import { targets } from './targets/index.js';
import { reportWorkerFailure, runWorker } from './worker.js';

runWorker(targets).catch(reportWorkerFailure);
