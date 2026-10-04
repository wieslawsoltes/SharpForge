// Copy this identical runner to the baseline worktree; run baseline and candidate serially.
// Both engines' existing TimeSpan/Object.ToString controls run before new Stopwatch paths.
// Optional --engine source|cil --case NAME selects one measured workload for a fresh-process comparison.
// Use the identical fixed five-warmup/nine-sample policy on both revisions.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {dirname, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const positional = [], options = {};
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument.startsWith('--')) {
    assert(['--engine', '--case'].includes(argument) && !(argument in options), 'Expected optional --engine/--case once each');
    const value = process.argv[++index];
    assert(value && !value.startsWith('--'), 'Each selection flag requires a value');
    options[argument] = value;
  } else {
    assert(positional.length < 2, 'Expected call count and revision label');
    positional.push(argument);
  }
}
const calls = Number(positional[0] ?? 1000);
const revisionLabel = positional[1] ?? 'unspecified';
const warmups = 5, sampleCount = 9;
const selectedEngine = options['--engine'] ?? null, selectedCase = options['--case'] ?? null;
assert(Number.isInteger(calls) && calls >= 100 && calls <= 5000, 'Calls must be within 100..5000');
assert(revisionLabel.length <= 120, 'Revision label must contain at most 120 characters');
assert(selectedEngine === null || ['source', 'cil'].includes(selectedEngine), 'Engine must be source or cil');
const controlCases = new Set(['zeroAndTotalSeconds', 'fromMillisecondsAndTotalSeconds', 'totalSeconds',
  'totalMilliseconds', 'objectToStringBuilder']);
const stopwatchCases = new Set(['timestampInjected', 'constructorAndIsRunning', 'startNewAndIsRunning',
  'startStopAndElapsedTicks', 'elapsedTicksStopped', 'elapsedMillisecondsStopped', 'elapsedAndTotalSeconds',
  'elapsedPairAndTotalSeconds', 'toStringStopped', 'timestampDefault']);
assert(selectedCase === null || controlCases.has(selectedCase) || stopwatchCases.has(selectedCase), 'Case must name one workload');
const engineNames = selectedEngine === null ? ['source', 'cil'] : [selectedEngine];
const owner = 'System.Diagnostics.Stopwatch';
const spanOwner = 'System.TimeSpan';
const clockStep = 1_000_000n;
const source = 'class Program { static void Main() {} }';
const program = compileToIL(source);
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const hash = value => createHash('sha256').update(value).digest('hex');
const runnerFile = fileURLToPath(import.meta.url), workspace = resolve(dirname(runnerFile), '../..');

function contract(type, name, parameters = [], required = true) {
  const found = findContracts(type, name).find(row => row.parameters.join(',') === parameters.join(','));
  if (required) assert(found, `Required contract ${type}.${name}(${parameters.join(',')})`);
  return found;
}

function createHost(engine, defaultClock = false) {
  let timestamp = 0n;
  const options = defaultClock ? {} : {stopwatchClock: () => {
    const value = timestamp; timestamp += clockStep; return value;
  }};
  const vm = engine === 'source' ? new VirtualMachine(program.image, options) : new CilVirtualMachine(program.assembly, options);
  const handles = [];
  return {vm, platform: vm.platform,
    pin(reference) { handles.push(vm.heap.createHandle(reference)); return reference; },
    stop() { for (const handle of handles) vm.heap.releaseHandle(handle); vm.stop(); }};
}

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {median, p95: sorted[Math.ceil(sorted.length * 0.95) - 1]};
}

function measure(host, workload) {
  const {platform} = host;
  const results = Array(calls);
  const samples = [];
  for (let sample = -warmups; sample < sampleCount; sample++) {
    platform.heap.collect();
    workload.prepare?.();
    globalThis.gc?.();
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const collections = platform.heap.stats.collections;
    const started = performance.now();
    for (let index = 0; index < calls; index++) results[index] = workload.run();
    const elapsedMs = performance.now() - started;
    const measured = {elapsedMs, nanosecondsPerCall: elapsedMs * 1_000_000 / calls,
      managedAllocations: platform.heap.stats.allocations - allocations,
      managedAllocatedBytes: platform.heap.stats.allocatedBytes - bytes,
      managedCollections: platform.heap.stats.collections - collections};
    for (let index = 0; index < calls; index++) workload.check(platform.native(results[index]), index, results);
    if (sample >= 0) samples.push(measured);
  }
  const result = {calls, samples};
  for (const name of Object.keys(samples[0])) result[name] = summary(samples.map(value => value[name]));
  return result;
}

function timeSpanControls(host) {
  const {platform} = host;
  const zero = contract(spanOwner, 'get_Zero');
  const fromMilliseconds = contract(spanOwner, 'FromMilliseconds', ['double']);
  const seconds = contract(spanOwner, 'get_TotalSeconds');
  const milliseconds = contract(spanOwner, 'get_TotalMilliseconds');
  const input = [platform.managed(1234.5, 'double')];
  const reference = host.pin(platform.invoke(fromMilliseconds, input));
  assert.equal(platform.get(reference, '$ticks'), null, 'Getter controls must exercise existing TimeSpan storage');
  return [
    {name: 'zeroAndTotalSeconds', run: () => platform.invoke(seconds, [platform.invoke(zero, [])]),
      check: value => assert.equal(value, 0)},
    {name: 'fromMillisecondsAndTotalSeconds', run: () => platform.invoke(seconds, [platform.invoke(fromMilliseconds, input)]),
      check: value => assert.equal(value, 1.2345)},
    {name: 'totalSeconds', run: () => platform.invoke(seconds, [reference]), check: value => assert.equal(value, 1.2345)},
    {name: 'totalMilliseconds', run: () => platform.invoke(milliseconds, [reference]), check: value => assert.equal(value, 1234.5)}
  ];
}

function frameworkObjectControl(host) {
  const {platform} = host;
  const constructor = contract('System.Text.StringBuilder', '.ctor', ['string']);
  const expected = 'StringBuilder control';
  const reference = host.pin(platform.invoke(constructor, [platform.managed(expected, 'string')]));
  assert.equal(typeof platform.bclHost.invokeObjectToString, 'function');
  return {name: 'objectToStringBuilder',
    run: () => platform.native(platform.bclHost.invokeObjectToString(platform, reference).value),
    check: value => assert.equal(value, expected)};
}

function checkTimestamp(value, index, results) {
  assert.equal(typeof value, 'bigint');
  assert(value >= 0n && value <= 9_223_372_036_854_775_807n);
  if (index) assert(value >= results[index - 1]);
}

function stopwatchWorkloads(host) {
  const {platform} = host;
  const constructor = contract(owner, '.ctor');
  const startNew = contract(owner, 'StartNew');
  const start = contract(owner, 'Start');
  const stop = contract(owner, 'Stop');
  const reset = contract(owner, 'Reset');
  const running = contract(owner, 'get_IsRunning');
  const ticks = contract(owner, 'get_ElapsedTicks');
  const milliseconds = contract(owner, 'get_ElapsedMilliseconds');
  const elapsed = contract(owner, 'get_Elapsed');
  const pair = contract(owner, 'GetElapsedTime', ['long', 'long']);
  const seconds = contract(spanOwner, 'get_TotalSeconds');
  const timestamp = contract(owner, 'GetTimestamp');
  const toString = contract(owner, 'ToString');
  const reference = host.pin(platform.invoke(constructor, []));
  const args = [reference];
  const clear = () => platform.invoke(reset, args);
  const stopped = () => { clear(); platform.invoke(start, args); platform.invoke(stop, args); };
  return [
    {name: 'timestampInjected', run: () => platform.invoke(timestamp, []), check: checkTimestamp},
    {name: 'constructorAndIsRunning', run: () => platform.invoke(running, [platform.invoke(constructor, [])]),
      check: value => assert.equal(Boolean(value), false)},
    {name: 'startNewAndIsRunning', run: () => platform.invoke(running, [platform.invoke(startNew, [])]),
      check: value => assert.equal(Boolean(value), true)},
    {name: 'startStopAndElapsedTicks', prepare: clear, run: () => {
      platform.invoke(start, args); platform.invoke(stop, args); return platform.invoke(ticks, args);
    }, check: (value, index) => assert.equal(value, BigInt(index + 1) * clockStep)},
    {name: 'elapsedTicksStopped', prepare: stopped, run: () => platform.invoke(ticks, args),
      check: value => assert.equal(value, clockStep)},
    {name: 'elapsedMillisecondsStopped', prepare: stopped, run: () => platform.invoke(milliseconds, args),
      check: value => assert.equal(value, 1n)},
    {name: 'elapsedAndTotalSeconds', prepare: stopped, run: () => platform.invoke(seconds, [platform.invoke(elapsed, args)]),
      check: value => assert.equal(value, 0.001)},
    {name: 'elapsedPairAndTotalSeconds', run: () => platform.invoke(seconds, [platform.invoke(pair, [0n, 1_500_000_000n])]),
      check: value => assert.equal(value, 1.5)},
    {name: 'toStringStopped', prepare: stopped, run: () => platform.native(platform.invoke(toString, args)),
      check: value => assert.equal(value, '00:00:00.0010000')}
  ];
}

function selected(workloads) {
  return selectedCase === null ? workloads : workloads.filter(workload => workload.name === selectedCase);
}

function runControls(engine) {
  if (selectedCase !== null && !controlCases.has(selectedCase)) return {};
  const host = createHost(engine);
  const controls = {};
  try {
    const workloads = selectedCase === 'objectToStringBuilder' ? [] : timeSpanControls(host);
    if (selectedCase === null || selectedCase === 'objectToStringBuilder') workloads.push(frameworkObjectControl(host));
    for (const workload of selected(workloads)) {
      executionOrder.push({engine, group: 'controls', case: workload.name});
      controls[workload.name] = measure(host, workload);
    }
    return controls;
  } finally { host.stop(); }
}

function runStopwatch(engine) {
  if (selectedCase !== null && !stopwatchCases.has(selectedCase)) return {};
  if (!contract(owner, '.ctor', [], false)) return {skipped: true, reason: 'Stopwatch is absent on baseline'};
  const stopwatch = {};
  if (selectedCase !== 'timestampDefault') {
    const host = createHost(engine);
    try {
      for (const workload of selected(stopwatchWorkloads(host))) {
        executionOrder.push({engine, group: 'stopwatch', case: workload.name});
        stopwatch[workload.name] = measure(host, workload);
      }
    } finally { host.stop(); }
  }
  if (selectedCase === null || selectedCase === 'timestampDefault') {
    const defaultHost = createHost(engine, true);
    try {
      const timestamp = contract(owner, 'GetTimestamp');
      executionOrder.push({engine, group: 'stopwatch', case: 'timestampDefault'});
      stopwatch.timestampDefault = measure(defaultHost, {run: () => defaultHost.platform.invoke(timestamp, []), check: checkTimestamp});
    } finally { defaultHost.stop(); }
  }
  return stopwatch;
}

const engines = {};
const executionOrder = [];
for (const engine of engineNames) engines[engine] = {controls: runControls(engine)};
for (const engine of engineNames) engines[engine].stopwatch = runStopwatch(engine);
console.log(JSON.stringify({revisionLabel,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: workspace, encoding: 'utf8'}).trim(),
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, warmups, samples: sampleCount, gcAvailable: typeof globalThis.gc === 'function',
  sourceSha256: hash(source), assemblySha256: hash(program.assembly), runnerSha256: hash(readFileSync(runnerFile)),
  selection: {engine: selectedEngine ?? 'all', case: selectedCase ?? 'all'},
  isolatedWorkload: selectedEngine !== null && selectedCase !== null, executionOrder,
  workload: 'Real source/CIL VM platforms: existing TimeSpan/Object.ToString controls and separate new Stopwatch/clock costs',
  notes: 'Compilation, setup, explicit GC and checks are excluded; automatic managed GC remains measured. Factory cases include the named getter.',
  engines}, null, 2));
