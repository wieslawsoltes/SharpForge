import { parentPort, workerData } from 'node:worker_threads';
import { runGitParserFuzz } from './run.js';

try { parentPort.postMessage({ result: await runGitParserFuzz(workerData) }); }
catch (error) {
  parentPort.postMessage({ error: { name: error.name, message: error.message, stack: error.stack, reproducer: error.reproducer } });
}
finally { parentPort.close(); }
