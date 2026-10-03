import { parseArgs } from 'node:util';
import { validateDag } from './validate-dag.js';
import { isMain, readJSON, report } from './lib/io.js';
export { validateDag };
if (isMain(import.meta.url)) { const { values } = parseArgs({ options: { snapshot: { type: 'string', default: 'planning/backlog.snapshot.json' } } }); report(validateDag(readJSON(values.snapshot))); }
