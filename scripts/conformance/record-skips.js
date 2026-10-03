import {readFile, writeFile} from 'node:fs/promises';
import {resultPath} from './results.js';
const registry = JSON.parse(await readFile(new URL('../../planning/qualification/skips.json', import.meta.url), 'utf8'));
const skip = registry.skips.find(item => item.id === process.argv[2]);
if (!skip || skip.status !== 'not-qualified' || !skip.issue || !skip.reason || !skip.removalCondition) throw new Error('Missing or incomplete tracked qualification exclusion');
await writeFile(await resultPath(skip.id + '-skip.json'), JSON.stringify({...skip, recordedAt: new Date().toISOString()}, null, 2) + '\n');
console.log(`NOT QUALIFIED: ${skip.command}: ${skip.reason}`);
