import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmarkMain } from '../bench/large-repo.js';

export { runLargeRepositoryBenchmark, benchmarkMain } from '../bench/large-repo.js';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await benchmarkMain();
