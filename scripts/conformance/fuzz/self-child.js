import { selfChecks } from './self-checks.js';
import { reportWorkerFailure, runWorker } from './worker.js';

runWorker(selfChecks, { selfTest: true }).catch(reportWorkerFailure);
