import {readFileSync} from 'node:fs';
import {comparePerformance, qualifyBaseline} from '../bench/vm/gate.js';
import {isMain, writeReport, recordError} from '../bench/vm/evidence.js';

export {comparePerformance, qualifyBaseline};
export function gateOptions(args) {
  const options = {baseline: 'docs/performance/a05-baseline.json', candidate: null,
    out: 'artifacts/a05-performance-gate.json', threshold: 0.05, confidence: 0.95, resamples: 10000, seed: 12012};
  const keys = {'--baseline': 'baseline', '--candidate': 'candidate', '--out': 'out', '--threshold': 'threshold',
    '--confidence': 'confidence', '--resamples': 'resamples', '--seed': 'seed', '--qualify': 'qualify', '--repeat': 'repeat'};
  for (let index = 0; index < args.length; index += 2) {
    const key = keys[args[index]], value = args[index + 1];
    if (!key || value === undefined || value.startsWith('--')) throw new TypeError('Unknown or missing gate option: ' + args[index]);
    options[key] = ['threshold', 'confidence', 'resamples', 'seed'].includes(key) ? Number(value) : value;
  }
  if (options.qualify ? !options.repeat || options.candidate : !options.candidate || options.repeat) {
    throw new TypeError('Use --candidate report, or --qualify first-report --repeat second-report');
  }
  return options;
}

if (isMain(import.meta.url)) {
  let options;
  try {
    options = gateOptions(process.argv.slice(2));
    const read = path => JSON.parse(readFileSync(path, 'utf8'));
    const result = options.qualify ? qualifyBaseline(read(options.qualify), read(options.repeat))
      : comparePerformance(read(options.baseline), read(options.candidate), options);
    writeReport(result, options.out);
    process.stdout.write(`${result.status}: ${options.out}\n`);
    process.exitCode = result.status === 'regression' ? 1 : 0;
  } catch (error) {
    if (options) writeReport({status: 'invalid', error: recordError(error), stability: error.stability ?? null}, options.out);
    process.stderr.write(error.stack + '\n');
    process.exitCode = 2;
  }
}
