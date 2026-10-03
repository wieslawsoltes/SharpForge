import { parseArgs } from 'node:util';
import { readiness, requireReady, contractsOnMain } from './ready.js';
import { isMain, readJSON, report } from './lib/io.js';
export { readiness, requireReady, contractsOnMain };
if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { snapshot: { type: 'string', default: 'planning/backlog.snapshot.json' }, task: { type: 'string' }, contracts: { type: 'string' } } });
  const result = readiness(readJSON(values.snapshot), values.task, values.contracts ? contractsOnMain(readJSON(values.contracts)) : {}); report(result); if (!result.ready) process.exitCode = 1;
}
