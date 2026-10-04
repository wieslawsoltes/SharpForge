// Copy this exact runner to the same relative path at integrated #4517 726fbd83; execute both checkouts serially.
// node --expose-gc packages/bcl-io/benchmarks/string-writer-scalars.mjs [calls=64] [length=1024] [baseline.json]
// Optional filters: --engine source|cil and repeatable --case exact-workload-name.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {fileURLToPath} from 'node:url';
import {decimal} from '@sharpforge/bytecode';
import {findContracts} from '@sharpforge/framework';
import {writerPlatform, writerType} from '../../../tests/fixtures/text-writer/engines.js';

function parseArguments(args) {
  const positional = [];
  const cases = new Set();
  let engine = null;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--engine' || argument === '--case') {
      const value = args[++index];
      assert(value && !value.startsWith('--'), 'Missing value for ' + argument);
      if (argument === '--engine') {
        assert(engine === null, 'Specify --engine only once');
        assert(['source', 'cil'].includes(value), 'Engine must be source or cil');
        engine = value;
      } else {
        assert(!cases.has(value), 'Duplicate workload selector: ' + value);
        cases.add(value);
      }
    } else {
      assert(!argument.startsWith('--'), 'Unknown option: ' + argument);
      positional.push(argument);
    }
  }
  assert(positional.length <= 3, 'Expected calls, length and an optional baseline JSON path');
  return {positional, engine, cases};
}

const comparisonBase = '726fbd8303042c7634a057807b51adeaddffa9a8';
const selection = parseArguments(process.argv.slice(2));
const calls = Number(selection.positional[0] ?? 64);
const length = Number(selection.positional[1] ?? 1024);
assert(Number.isInteger(calls) && calls >= 1 && calls <= 1024, 'Calls must be an integer from 1 to 1024');
assert(Number.isInteger(length) && length >= 1 && length <= 4096, 'Length must be an integer from 1 to 4096');
assert(calls * (length + 1) <= 262144, 'Keep each buffer writer at or below 262144 output units');
const input = Array.from({length}, (_, index) => [65, 0, 0xd800, 0xdc00, 0xffff][index % 5]);
const text = String.fromCharCode(...input);
const scalars = [
  {type: 'bool', value: true, text: 'True'},
  {type: 'int', value: -2147483648, text: '-2147483648'},
  {type: 'uint', value: 4294967295, text: '4294967295'},
  {type: 'long', value: -9007199254740993n, text: '-9007199254740993'},
  {type: 'ulong', value: 18446744073709551615n, text: '18446744073709551615'},
  {type: 'float', value: Math.fround(0.1), text: '0.1'},
  {type: 'double', value: 0.8455124082255701, text: '0.8455124082255701'},
  {type: 'decimal', value: decimal(1234500n, 4), text: '123.4500'}
];
const workloads = [
  {name: 'string-control', method: 'Write', parameters: ['string'], value: text, text},
  {name: 'string-line-control', method: 'WriteLine', parameters: ['string'], value: text, text},
  {name: 'character-control', method: 'Write', parameters: ['char'], value: 0xd800, text: '\ud800'},
  {name: 'character-line-control', method: 'WriteLine', parameters: ['char'], value: 0xd800, text: '\ud800'},
  {name: 'separate-character-control', method: 'Write', parameters: ['char'], value: 0xd800, text: '\ud800', separate: true},
  ...['Write', 'WriteLine'].flatMap(method => [false, true].map(slice => ({
    name: `${slice ? 'slice' : 'whole'}-buffer-${method === 'Write' ? 'write' : 'line'}-control`,
    method, parameters: slice ? ['char[]', 'int', 'int'] : ['char[]'], buffer: true, slice, text
  }))),
  ...[false, true].map(slice => ({name: `separate-${slice ? 'slice' : 'whole'}-buffer-control`,
    method: 'Write', parameters: slice ? ['char[]', 'int', 'int'] : ['char[]'], buffer: true, slice, separate: true, text})),
  ...scalars.flatMap(scalar => [
    ...['Write', 'WriteLine'].flatMap(method => [
      {name: `scalar-${scalar.type}-${method}-string-control`, method, parameters: ['string'], value: scalar.text, text: scalar.text},
      {name: `scalar-${scalar.type}-${method}`, method, parameters: [scalar.type], value: scalar.value, text: scalar.text, added: true}
    ]),
    {name: `scalar-${scalar.type}-separate-line`, method: 'Write', parameters: [scalar.type],
      value: scalar.value, text: scalar.text, separate: true, added: true}
  ])
];
for (const name of selection.cases) assert(workloads.some(workload => workload.name === name), 'Unknown workload: ' + name);
const selectedWorkloads = workloads.filter(workload => !selection.cases.size || selection.cases.has(workload.name));
// Finish controls on every selected engine before a candidate-only path can change execution history.
const orderedWorkloads = [...selectedWorkloads.filter(workload => !workload.added), ...selectedWorkloads.filter(workload => workload.added)];
const selectedEngines = selection.engine ? [selection.engine] : ['source', 'cil'];
const selectedCases = orderedWorkloads.map(workload => workload.name);
const find = (name, parameters) => findContracts(writerType, name)
  .find(member => member.parameters.join(',') === parameters.join(','));
const newline = find('WriteLine', []);
assert(newline, 'The released parameterless WriteLine control must exist');
const availableScalars = scalars.flatMap(scalar => ['Write', 'WriteLine'].map(method => find(method, [scalar.type]))).filter(Boolean);
assert([0, 16].includes(availableScalars.length), 'A comparison checkout must provide either zero or all sixteen scalar contracts');
const configuration = {schemaVersion: 1,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    encoding: 'utf8', timeout: 5000}).trim(),
  comparisonBase, runnerSha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, length, warmups: 1, samples: 5, hostGc: typeof globalThis.gc === 'function',
  selectedEngines, selectedCases, workloadOrder: 'released-controls-first'};
const baseline = selection.positional[2] ? JSON.parse(readFileSync(selection.positional[2], 'utf8')) : null;
if (baseline) validateComparison(baseline, configuration);

function summary(samples, key) {
  const values = samples.map(sample => sample[key]).toSorted((left, right) => left - right);
  return {median: values[Math.floor(values.length / 2)], p95: values[Math.ceil(values.length * 0.95) - 1]};
}

function sample(engine, workload, descriptor) {
  const writer = writerPlatform(engine);
  const {platform, vm, reference, call} = writer;
  const {heap} = platform;
  let root = null;
  let slotWrites = 0;
  try {
    const buffer = workload.buffer ? heap.allocate('array', 'char[]', workload.slice ? [33, ...input, 63] : [...input]) : null;
    if (buffer) root = heap.createHandle(buffer);
    const args = workload.buffer ? workload.slice ? [reference, buffer, 1, length] : [reference, buffer] : [reference, workload.value];
    const newlineArgs = [reference];
    vm.onWrite = event => { if (event.kind === 'array') slotWrites++; };
    globalThis.gc?.();
    const allocations = heap.stats.allocations;
    const bytes = heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < calls; index++) {
      platform.invoke(descriptor, args);
      if (workload.separate) platform.invoke(newline, newlineArgs);
    }
    const elapsedMs = performance.now() - started;
    const result = {elapsedMs, managedAllocations: heap.stats.allocations - allocations,
      managedAllocatedBytes: heap.stats.allocatedBytes - bytes, slotWrites};
    vm.onWrite = null;
    const unit = workload.text + (workload.method === 'WriteLine' || workload.separate ? '\n' : '');
    assert.equal(platform.native(call('ToString')), unit.repeat(calls), engine + '/' + workload.name);
    assert.equal(heap.pins.length, 0, 'Every timed invocation must release its temporary roots');
    return result;
  } finally { vm.onWrite = null; if (root !== null) heap.releaseHandle(root); writer.stop(); }
}

const engines = Object.fromEntries(selectedEngines.map(engine => [engine, {}]));
for (const workload of orderedWorkloads) {
  const descriptor = find(workload.method, workload.parameters);
  const outputUnits = calls * (workload.text.length + (workload.method === 'WriteLine' || workload.separate ? 1 : 0));
  assert(outputUnits <= 262144, 'Scalar and control writers must stay within the output bound');
  assert(descriptor || workload.added, 'A released comparison control is missing: ' + workload.name);
  for (const engine of Object.keys(engines)) {
    if (!descriptor) {
      engines[engine][workload.name] = {skipped: true, reason: 'Scalar overload absent on the baseline'};
      continue;
    }
    const samples = [];
    for (let index = -1; index < 5; index++) {
      const value = sample(engine, workload, descriptor);
      if (index >= 0) samples.push(value);
    }
    engines[engine][workload.name] = {kind: workload.added ? 'scalar' : 'released-control',
      outputUnits, platformCalls: calls * (workload.separate ? 2 : 1),
      elapsedMs: summary(samples, 'elapsedMs'), managedAllocations: summary(samples, 'managedAllocations'),
      managedAllocatedBytes: summary(samples, 'managedAllocatedBytes'), slotWrites: summary(samples, 'slotWrites'), samples};
  }
}

function validateComparison(baseline, current) {
  assert.equal(baseline.commit, comparisonBase, 'Use the exact integrated #4517 baseline commit');
  for (const key of ['schemaVersion', 'runnerSha256', 'node', 'platform', 'arch', 'cpu', 'calls', 'length', 'warmups', 'samples',
    'hostGc', 'selectedEngines', 'selectedCases', 'workloadOrder']) {
    assert.deepEqual(baseline[key], current[key], 'Comparison configuration differs: ' + key);
  }
}

function compare(baseline, current) {
  const comparisons = {};
  for (const [engine, entries] of Object.entries(current.engines)) {
    comparisons[engine] = {};
    for (const [name, result] of Object.entries(entries)) {
      const previous = baseline.engines[engine]?.[name];
      assert(previous, 'Missing baseline workload: ' + engine + '/' + name);
      if (previous.skipped || result.skipped) {
        comparisons[engine][name] = {comparable: false, reason: 'A scalar path is absent on one revision'};
        continue;
      }
      assert.equal(previous.outputUnits, result.outputUnits, name);
      assert.equal(previous.platformCalls, result.platformCalls, name);
      const difference = (before, after) => before > 0 ? (after / before - 1) * 100 : null;
      comparisons[engine][name] = {comparable: true,
        medianPercent: difference(previous.elapsedMs.median, result.elapsedMs.median),
        p95Percent: difference(previous.elapsedMs.p95, result.elapsedMs.p95),
        managedAllocationsDelta: result.managedAllocations.median - previous.managedAllocations.median,
        managedAllocatedBytesDelta: result.managedAllocatedBytes.median - previous.managedAllocatedBytes.median,
        slotWritesDelta: result.slotWrites.median - previous.slotWrites.median};
    }
  }
  return {baselineCommit: baseline.commit, currentCommit: current.commit, engines: comparisons};
}

const report = {...configuration,
  workload: 'Source/CIL platform dispatch: unchanged string/character/buffer controls, exact scalar writes and separate newline controls',
  notes: 'Setup, argument preparation, host GC and final materialization excluded. Managed allocation and slot-write counters included.',
  engines};
if (baseline) report.comparison = compare(baseline, report);
console.log(JSON.stringify(report, null, 2));
