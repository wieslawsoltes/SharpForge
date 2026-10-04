// Copy this identical runner to baseline a7e7ab337fb677b1db2fc76e3ba8d5bdb6d1a006; run serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {findContracts} from '@sharpforge/framework';
import {builderPlatform, builderContract, builderType} from '../../tests/fixtures/string-builder/append-char.js';

const calls = Number(process.argv[2] ?? 5000);
const stressCalls = Number(process.argv[3] ?? 100);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 20000);
assert(Number.isInteger(stressCalls) && stressCalls >= 20 && stressCalls <= 1000);
const definitions = [
  {name: 'releasedLength', method: 'get_Length', parameters: [], segments: ['axa'], forward: [], reverse: [], result: 3},
  {name: 'releasedStringReplace', method: 'Replace', parameters: ['string', 'string'], segments: ['axa'],
    forward: ['a', 'b'], reverse: ['b', 'a'], initial: 'axa', changed: 'bxb'},
  {name: 'newWhole', segments: ['axa'], forward: [97, 98], reverse: [98, 97], initial: 'axa', changed: 'bxb'},
  {name: 'newRange', segments: ['a', 'axa', 'a'], forward: [97, 98, 1, 3], reverse: [98, 97, 1, 3], initial: 'aaxaa', changed: 'abxba'},
  {name: 'newNoMatch', segments: ['axa'], forward: [113, 120], reverse: [113, 120], initial: 'axa', changed: 'axa'},
  {name: 'newSameUnit', segments: ['axa'], forward: [97, 97], reverse: [97, 97], initial: 'axa', changed: 'axa'},
  {name: 'newEmptyRange', segments: ['axa'], forward: [97, 98, 3, 0], reverse: [98, 97, 3, 0], initial: 'axa', changed: 'axa'},
  {name: 'newManyChunks', segments: Array(256).fill('axax'), forward: [97, 98], reverse: [98, 97],
    initial: 'axax'.repeat(256), changed: 'bxbx'.repeat(256), long: true},
  {name: 'newSmallWindow', segments: Array(256).fill('axax'), forward: [97, 98, 508, 4], reverse: [98, 97, 508, 4],
    initial: 'axax'.repeat(256), changed: 'axax'.repeat(127) + 'bxbx' + 'axax'.repeat(128), long: true}
];
const summary = values => {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
};

function prepare(platform, row) {
  const reference = platform.invoke(builderContract('.ctor', ['int']), [1]);
  platform.heap.pins.push(reference);
  for (const text of row.segments) platform.invoke(builderContract('Append', ['string']), [reference, platform.heap.string(text)]);
  const parameters = row.parameters ?? (row.forward.length === 4 ? ['char', 'char', 'int', 'int'] : ['char', 'char']);
  const descriptor = findContracts(builderType, row.method ?? 'Replace').find(item => item.parameters.join(',') === parameters.join(','));
  const args = values => [reference, ...values.map(value => {
    if (typeof value !== 'string') return value;
    const managed = platform.heap.string(value);
    platform.heap.pins.push(managed);
    return managed;
  })];
  return {...row, reference, descriptor, forward: args(row.forward), reverse: args(row.reverse)};
}

function measure(platform, row, snapshot) {
  if (!row.descriptor) return {skipped: true, reason: 'Character Replace contract is absent on baseline'};
  const count = row.long ? stressCalls : calls;
  const samples = [];
  let returned;
  for (let sample = -1; sample < 5; sample++) {
    platform.heap.restore(snapshot);
    globalThis.gc?.();
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < count; index++) returned = platform.invoke(row.descriptor, index % 2 ? row.reverse : row.forward);
    const elapsedMs = performance.now() - started;
    const managedAllocations = platform.heap.stats.allocations - allocations;
    const managedAllocatedBytes = platform.heap.stats.allocatedBytes - bytes;
    if (row.result !== undefined) assert.equal(returned, row.result);
    else {
      assert.deepEqual(returned, row.reference);
      const text = platform.native(platform.invoke(builderContract('ToString'), [row.reference]));
      assert.equal(text, count % 2 ? row.changed : row.initial);
    }
    if (sample >= 0) samples.push({elapsedMs, managedAllocations, managedAllocatedBytes});
  }
  return {calls: count, elapsedMs: summary(samples.map(row => row.elapsedMs)),
    managedAllocations: summary(samples.map(row => row.managedAllocations)),
    managedAllocatedBytes: summary(samples.map(row => row.managedAllocatedBytes)), samples};
}
function run(engine) {
  const runner = builderPlatform(engine, '');
  try {
    return runner.platform.heap.withRoots([], () => {
      const prepared = definitions.map(row => prepare(runner.platform, row));
      const snapshot = runner.platform.heap.snapshot();
      return Object.fromEntries(prepared.map(row => [row.name, measure(runner.platform, row, snapshot)]));
    });
  } finally {runner.stop();}
}
const engines = {};
for (const engine of ['source', 'cil']) engines[engine] = run(engine);
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, stressCalls, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  notes: 'Same runner before/after. Setup, restore, host GC and assertions excluded. Alternating units force real edits each call.',
  engines}, null, 2));
