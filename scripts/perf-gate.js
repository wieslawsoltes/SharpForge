import {readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {comparePerformance, qualifyBaseline, compareMetric} from '../bench/vm/gate.js';
import {validateBootstrapOptions} from '../bench/vm/statistics.js';
import {isMain, writeReport, recordError} from '../bench/vm/evidence.js';

export {comparePerformance, qualifyBaseline, compareMetric};

export function gateOptions(args) {
  const options = {baseline: 'docs/performance/a05-baseline.json', candidate: null,
    out: 'artifacts/a05-performance-gate.json', threshold: 0.05, confidence: 0.95, resamples: 10000, seed: 12012};
  const keys = {'--baseline': 'baseline', '--candidate': 'candidate', '--out': 'out', '--threshold': 'threshold',
    '--confidence': 'confidence', '--resamples': 'resamples', '--seed': 'seed', '--qualify': 'qualify', '--repeat': 'repeat'};
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const key = keys[args[index]];
    const value = args[index + 1];
    if (!key || !value || value.startsWith('--')) throw new TypeError('Unknown or missing gate option: ' + args[index]);
    if (seen.has(key)) throw new TypeError('Duplicate gate option: ' + args[index]);
    seen.add(key);
    options[key] = ['threshold', 'confidence', 'resamples', 'seed'].includes(key) ? Number(value) : value;
  }
  if (options.qualify ? !options.repeat || options.candidate || seen.has('baseline') : !options.candidate || options.repeat) {
    throw new TypeError('Use --baseline/--candidate, or --qualify first-report --repeat second-report');
  }
  validateBootstrapOptions(options);
  const inputs = options.qualify ? [options.qualify, options.repeat] : [options.baseline, options.candidate];
  if (inputs.some(path => resolve(path) === resolve(options.out))) {
    throw new TypeError('Gate output must not overwrite its input measurements');
  }
  return options;
}

function readReport(path) {
  if (statSync(path).size > 256 * 1024 * 1024) throw new RangeError('Performance report exceeds the 256 MiB read limit');
  return JSON.parse(readFileSync(path, 'utf8'));
}

if (isMain(import.meta.url)) {
  let options;
  try {
    options = gateOptions(process.argv.slice(2));
    const result = options.qualify ? qualifyBaseline(readReport(options.qualify), readReport(options.repeat))
      : comparePerformance(readReport(options.baseline), readReport(options.candidate), options);
    writeReport(result, options.out);
    process.stdout.write(`${result.status}: ${options.out}\n`);
    process.exitCode = result.status === 'regression' ? 1 : 0;
  } catch (error) {
    if (options) writeReport({status: 'invalid', error: recordError(error), stability: error.stability ?? null}, options.out);
    process.stderr.write(error.stack + '\n');
    process.exitCode = 2;
  }
}
