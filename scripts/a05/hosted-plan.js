import {join} from 'node:path';

export const hostedRunner = 'a05-gh-ubuntu2404-node2419-x64';
export const hostedResources = Object.freeze({SHARPFORGE_TEST_CONCURRENCY: '1',
  SHARPFORGE_MAX_PARALLEL_RUNS: '1', SHARPFORGE_MAX_OLD_SPACE_MB: '512'});
export const hostedQueueMinutes = 340;

/** Fixed queue, separate from the benchmark catalog: no retries, option overrides or row splicing. */
export function hostedPlan(directory, reference) {
  const commands = [];
  const add = (id, script, args, kind, {rows = [], dependencies = [], flags = ['--expose-gc']} = {}) => {
    const output = join(directory, id + '.json');
    commands.push({id, kind, rows, dependencies, output,
      argv: ['scripts/limited.js', process.execPath, ...flags, script, ...args, '--out', output]});
  };
  const qualification = (id, args, kind, rows, dependencies = []) => add(id, 'bench/vm/qualification.js',
    ['--runner', hostedRunner, '--seed', '12012', '--resamples', '10000', ...args], kind, {rows, dependencies});
  const target = id => qualification(id, ['--suite', 'targets', '--target', id, '--samples', '100',
    '--warmup', '3', '--native-bits', '64', '--timeout-seconds', '900'], 'target', [id]);
  target('source-fibonacci');
  target('virtual-cache');
  add('profiler-reference', 'bench/vm/profiler-reference.js', ['--dir', reference], 'reference', {flags: []});
  for (const mode of ['off', 'on']) {
    const rows = ['source', 'cil'].flatMap(engine => ['arith', 'calls', 'allocation'].map(name => `profiler-${mode}-${engine}-${name}`));
    const args = ['--suite', 'profiler', '--profiler-mode', mode, '--samples', '100', '--warmup', '10',
      '--native-bits', '64', '--timeout-seconds', '1800'];
    if (mode === 'off') args.push('--profiler-reference', join(directory, 'profiler-reference.json'));
    qualification('profiler-' + mode, args, 'profiler-' + mode, rows, mode === 'off' ? ['profiler-reference'] : []);
  }
  for (const id of ['source-integer-loop', 'int32-specialization', 'small-long', 'scalar-slot-loads',
    'frame-pool-source', 'frame-pool-cil', 'warm-call-plans', 'warm-fields']) target(id);
  qualification('roots', ['--suite', 'roots', '--samples', '100', '--warmup', '10', '--root-scans', '20',
    '--native-bits', '64', '--timeout-seconds', '900'], 'target', ['root-visitor-source', 'root-visitor-cil']);
  for (const width of ['32', '64']) qualification('numeric-' + width, ['--suite', 'differential', '--width', width,
    '--int' + width + '-cases', width === '32' ? '1000000' : '10000000', '--native-bits', '32',
    '--timeout-seconds', '900'], 'differential', ['numeric-' + width]);
  qualification('fairness', ['--suite', 'fairness', '--array-elements', '1000000', '--native-bits', '32',
    '--timeout-seconds', '900'], 'target', ['array-sort-fairness-source', 'array-sort-fairness-cil', 'tiered-loop-fairness-cil']);
  add('float-allocation', 'bench/vm/float-allocation.js', ['--runner', hostedRunner, '--warmup-slices', '10',
    '--warmup', '100000', '--iterations', '1000000'], 'float', {flags: []});
  add('snapshot-retention', 'bench/vm/snapshot-retention.js', ['--runner', hostedRunner,
    '--scenario', 'original-records', '--max-retained-mib', '256'], 'snapshot');
  for (const name of ['byref', 'array', 'wasm']) {
    const rows = name === 'wasm' ? ['wasm-call-arithmetic', 'wasm-call-boxing'] : name === 'byref' ?
      ['source', 'reloaded', 'cil'].map(engine => 'byref-latency-' + engine) :
      ['grid', 'arrays'].flatMap(fixture => ['source', 'reloaded', 'cil'].map(engine => `array-latency-${fixture}-${engine}`));
    add(name + '-latency', `bench/vm/${name}-latency.js`, ['--runner', hostedRunner, '--native-bits', '64',
      '--samples', '100', '--warmup', '10', '--timeout-seconds', '900'], 'latency', {rows});
  }
  for (const name of ['first', 'repeat']) add('t12-' + name, 'bench/vm/harness.js', ['--runner', hostedRunner,
    '--samples', '100', '--warmup', '10', '--suite', 'all', '--engine', 'all', '--native-bits', '32'],
  't12', {flags: ['--max-old-space-size=512', '--expose-gc']});
  add('t12-baseline', 'scripts/perf-gate.js', ['--qualify', join(directory, 't12-first.json'),
    '--repeat', join(directory, 't12-repeat.json')], 'gate', {dependencies: ['t12-first', 't12-repeat'], flags: []});
  return commands;
}

export function validateHostedPlan(records, directory, reference) {
  const expected = hostedPlan(directory, reference);
  if (!Array.isArray(records) || records.length !== expected.length || expected.some((command, index) =>
    Object.keys(command).some(key => JSON.stringify(records[index]?.[key]) !== JSON.stringify(command[key])))) {
    throw new Error('Recorded command queue differs from the committed fixed plan');
  }
}
