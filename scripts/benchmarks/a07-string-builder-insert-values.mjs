// Copy this identical runner to the baseline; execute revisions serially with the same arguments.
// Optional --engine source|cil and --case NAME isolate one workload in a fresh process.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {decimal} from '@sharpforge/bytecode';
import {findContracts} from '@sharpforge/framework';
import {builderPlatform, builderContract, builderType} from '../../tests/fixtures/string-builder/append-char.js';

const counts = [];
let selectedEngine = null, selectedCase = null;
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--engine') selectedEngine = process.argv[++index];
  else if (argument === '--case') selectedCase = process.argv[++index];
  else {
    assert(!argument.startsWith('--') && counts.length < 2, 'Expected call counts and optional --engine/--case');
    counts.push(argument);
  }
}
const calls = Number(counts[0] ?? 500);
const stressCalls = Number(counts[1] ?? 20);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 2000);
assert(Number.isInteger(stressCalls) && stressCalls >= 10 && stressCalls <= 100);
assert(selectedEngine === null || ['source', 'cil'].includes(selectedEngine), 'Engine must be source or cil');
const workloads = [
  {name: 'releasedLength', method: 'get_Length', parameters: [], output: 4},
  {name: 'releasedString', type: 'string', value: 'xy', output: 'xy'},
  {name: 'releasedCharacter', type: 'char', value: 65, output: 'A'},
  {name: 'releasedBoolean', type: 'bool', value: true, output: 'True'},
  {name: 'releasedRepeat', type: 'string', value: 'xy', suffix: [3], output: 'xyxyxy'},
  {name: 'releasedArrayAppend', method: 'Append', type: 'char[]', value: [65, 0, 0xd800], output: 'A\0\ud800'},
  {name: 'stringNull', type: 'string', value: null, output: ''},
  {name: 'stringEmpty', type: 'string', value: '', output: ''},
  {name: 'sbyteMinimum', type: 'sbyte', value: -128, output: '-128'},
  {name: 'byteMaximum', type: 'byte', value: 255, output: '255'},
  {name: 'shortMinimum', type: 'short', value: -32768, output: '-32768'},
  {name: 'ushortMaximum', type: 'ushort', value: 65535, output: '65535'},
  {name: 'intMinimum', type: 'int', value: -2147483648, output: '-2147483648'},
  {name: 'uintMaximum', type: 'uint', value: -1, output: '4294967295'},
  {name: 'longMinimum', type: 'long', value: -9223372036854775808n, output: '-9223372036854775808'},
  {name: 'ulongMaximum', type: 'ulong', value: -1n, output: '18446744073709551615'},
  {name: 'singleFraction', type: 'float', value: Math.fround(0.1), output: '0.1'},
  {name: 'doubleFraction', type: 'double', value: 0.1, output: '0.1'},
  {name: 'decimalScale', type: 'decimal', value: decimal(12300n, 4), output: '1.2300'},
  {name: 'objectCharacter', type: 'object', boxed: 'System.Char', value: 0xd800, output: '\ud800'},
  {name: 'objectBuilder', type: 'object', builder: true, value: 'xy', output: 'xy'},
  {name: 'objectNullInvalidIndex', type: 'object', value: null, index: -1, output: ''},
  {name: 'array', type: 'char[]', value: [65, 0, 0xd800, 0xdc00], output: 'A\0\ud800\udc00'},
  {name: 'arrayZeroRange', type: 'char[]', value: [65], suffix: [1, 0], output: ''},
  {name: 'arrayBlockRange', type: 'char[]', value: [88, ...Array(8195).fill(0xd800), 89],
    suffix: [1, 8195], output: '\ud800'.repeat(8195), long: true}
];
assert(selectedCase === null || workloads.some(row => row.name === selectedCase), 'Case must name one workload');
const engineNames = selectedEngine === null ? ['source', 'cil'] : [selectedEngine];
const selectedRows = selectedCase === null ? workloads : workloads.filter(row => row.name === selectedCase);

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function inputValue(platform, row) {
  if (row.value == null) return null;
  if (row.type === 'string') return platform.heap.string(row.value);
  if (row.type === 'char[]') return platform.heap.allocate('array', 'char[]', [...row.value]);
  if (row.boxed) return platform.heap.allocate('box', row.boxed, [row.value]);
  if (row.builder) return platform.invoke(builderContract('.ctor', ['string']), [platform.heap.string(row.value)]);
  return platform.managed(row.value, row.type);
}

function prepare(platform, row, count) {
  const value = inputValue(platform, row);
  platform.heap.pins.push(value);
  const args = [];
  const index = row.index ?? 2;
  for (let item = 0; item < count; item++) {
    const reference = platform.invoke(builderContract('.ctor', ['string']), [platform.heap.string('abcd')]);
    platform.heap.pins.push(reference);
    const values = row.method === 'get_Length' ? [reference] : row.method === 'Append'
      ? [reference, value] : [reference, index, value, ...(row.suffix ?? [])];
    args.push(values);
  }
  const expected = row.method === 'get_Length' ? row.output : row.method === 'Append' ? 'abcd' + row.output
    : row.output ? 'abcd'.slice(0, index) + row.output + 'abcd'.slice(index) : 'abcd';
  return {args, expected};
}

function measure(platform, row) {
  const parameters = row.parameters ?? (row.method === 'Append' ? [row.type]
    : ['int', row.type, ...(row.suffix ?? []).map(() => 'int')]);
  const descriptor = findContracts(builderType, row.method ?? 'Insert')
    .find(item => item.parameters.join(',') === parameters.join(','));
  if (!descriptor) return {skipped: true, reason: 'Value insertion overload is absent on baseline'};
  const count = row.long ? stressCalls : calls;
  const {args, expected} = prepare(platform, row, count);
  const snapshot = platform.heap.snapshot();
  const returned = Array(count);
  const samples = [];
  for (let sample = -1; sample < 5; sample++) {
    platform.heap.restore(snapshot);
    globalThis.gc?.();
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < count; index++) returned[index] = platform.invoke(descriptor, args[index]);
    const elapsedMs = performance.now() - started;
    const managedAllocations = platform.heap.stats.allocations - allocations;
    const managedAllocatedBytes = platform.heap.stats.allocatedBytes - bytes;
    for (let index = 0; index < count; index++) {
      if (row.method === 'get_Length') assert.equal(returned[index], expected);
      else {
        assert.deepEqual(returned[index], args[index][0]);
        assert.equal(platform.native(platform.invoke(builderContract('ToString'), [args[index][0]])), expected);
      }
    }
    if (sample >= 0) samples.push({elapsedMs, managedAllocations, managedAllocatedBytes});
  }
  return {calls: count, elapsedMs: summary(samples.map(row => row.elapsedMs)),
    managedAllocations: summary(samples.map(row => row.managedAllocations)),
    managedAllocatedBytes: summary(samples.map(row => row.managedAllocatedBytes)), samples};
}

function run(engine, rows) {
  const runner = builderPlatform(engine, '');
  const results = {};
  try {
    for (const row of rows) {
      results[row.name] = runner.platform.heap.withRoots([], () => measure(runner.platform, row));
      runner.platform.heap.collect();
    }
    return results;
  } finally { runner.stop(); }
}

const engines = {};
const executionOrder = [];
// Both engines' unchanged controls finish before candidate-only or changed-semantics workloads start.
for (const control of [true, false]) {
  const rows = selectedRows.filter(row => row.name.startsWith('released') === control);
  if (!rows.length) continue;
  for (const engine of engineNames) {
    executionOrder.push(...rows.map(row => ({engine, case: row.name})));
    Object.assign(engines[engine] ??= {}, run(engine, rows));
  }
}
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, stressCalls, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  runnerSha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
  selection: {engine: selectedEngine ?? 'all', case: selectedCase ?? 'all'},
  isolatedWorkload: selectedEngine !== null && selectedCase !== null, executionOrder,
  notes: 'Prepared fresh builders and inputs; setup, snapshot reset, host GC and assertions excluded. Host formatting/array text is not counted.',
  engines}, null, 2));
