import {resolve} from 'node:path';

export function requireQualificationOptions(options) {
  if (options.profilerMode !== undefined && (!['both', 'off', 'on'].includes(options.profilerMode) ||
      options.profilerMode !== 'both' && !['all', 'profiler'].includes(options.suite))) {
    throw new TypeError('Profiler mode requires all or profiler suite and must be off, on, or both');
  }
  if (options.target !== undefined && options.target !== null &&
      (typeof options.target !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(options.target) || options.suite !== 'targets')) {
    throw new TypeError('A named target requires the targets suite');
  }
  if (!Number.isInteger(options.samples) || options.samples < 20 || options.samples > 1000 ||
      !Number.isInteger(options.warmup) || options.warmup < 1 || options.warmup > 100 ||
      ![32, 64].includes(options.nativeBits) || !Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff ||
      !Number.isInteger(options.resamples) || options.resamples < 1000 || options.resamples > 100000 ||
      !Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0 || options.timeoutSeconds > 3600) {
    throw new RangeError('Invalid bounded qualification sample, ABI, seed or time options');
  }
}

export function parseQualificationOptions(args) {
  const options = {runner: '', out: 'artifacts/a05-qualification.json', suite: 'all', target: null, width: 'all',
    samples: 20, warmup: 3, nativeBits: 32, seed: 12012, resamples: 10000, timeoutSeconds: 900,
    int32Cases: 1000000, int64Cases: 10000000, rootScans: 20, arrayElements: 1000000, profilerReference: null, profilerMode: 'both'};
  const names = {'--runner': 'runner', '--out': 'out', '--suite': 'suite', '--target': 'target', '--width': 'width', '--samples': 'samples',
    '--warmup': 'warmup', '--native-bits': 'nativeBits', '--seed': 'seed', '--resamples': 'resamples',
    '--timeout-seconds': 'timeoutSeconds', '--int32-cases': 'int32Cases', '--int64-cases': 'int64Cases',
    '--root-scans': 'rootScans', '--array-elements': 'arrayElements', '--profiler-reference': 'profilerReference',
    '--profiler-mode': 'profilerMode'};
  const numeric = new Set(['samples', 'warmup', 'nativeBits', 'seed', 'resamples', 'timeoutSeconds',
    'int32Cases', 'int64Cases', 'rootScans', 'arrayElements']);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], key = names[name], value = args[index + 1];
    if (!key || value === undefined || value.startsWith('--') || seen.has(name)) throw new TypeError('Unknown, duplicate or missing option: ' + name);
    seen.add(name);
    options[key] = numeric.has(key) ? Number(value) : value;
  }
  requireQualificationOptions(options);
  if (!['all', 'differential', 'targets', 'roots', 'profiler', 'fairness'].includes(options.suite) ||
      !['all', '32', '64'].includes(options.width) || !/^[\w.-]{1,80}$/.test(options.runner) ||
      !Number.isInteger(options.rootScans) || options.rootScans < 1 || options.rootScans > 1000 ||
      !Number.isInteger(options.arrayElements) || options.arrayElements < 32 || options.arrayElements > 1000000 ||
      ['int32Cases', 'int64Cases'].some(key => !Number.isInteger(options[key]) || options[key] < 1 || options[key] > 10000000)) {
    throw new RangeError('Invalid qualification suite, case count, runner or fixture size');
  }
  if (options.profilerReference && resolve(options.profilerReference) === resolve(options.out)) {
    throw new Error('Qualification output cannot overwrite its profiler reference manifest');
  }
  return options;
}
