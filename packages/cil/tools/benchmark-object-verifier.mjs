import { resolve } from 'node:path';
import { args, integer, repository, writeJson } from '../../../scripts/conformance/perf/core.js';
import { controlCases, objectCases } from './verifier-benchmark-workloads.mjs';
import { measureVerifier } from './verifier-benchmark-measure.mjs';

const output = process.argv[2];
if (!output) throw new Error('Pass an output JSON path, optionally followed by --root and --case');
const options = args(process.argv.slice(3));
const selection = options.case ?? 'objects';
const names = selection === 'controls' ? controlCases : selection === 'objects' ? objectCases : [selection];
if (names.some(name => !controlCases.includes(name) && !objectCases.includes(name))) throw new Error('Unknown workload');
const result = await measureVerifier({ root: resolve(options.root ?? repository), harness: repository, names,
  iterations: integer(options.iterations, 1000, 1, 5000), samples: integer(options.samples, 100, 2, 1000),
  warmups: integer(options.warmups, 20, 0, 100) });
writeJson(output, result);
console.log(JSON.stringify(result.benchmarks.map(row => ({ id: row.id, ...row.statistics }))));
