// node --expose-gc scripts/benchmarks/a07-framework-object-string.mjs [calls=10000] [length=128]
// Copy this identical runner to 82ec8ed4; run baseline and fixed checkouts serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 10000);
const length = Number(process.argv[3] ?? 128);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 200000);
assert(Number.isInteger(length) && length >= 1 && length <= 2048);
const text = 'x'.repeat(length);
const cases = [
  {name: 'primitive-control', expression: '42', expected: ['42', 'System.Int32']},
  {name: 'builder-virtual', expression: `new StringBuilder(${JSON.stringify(text)})`, owner: 'System.Text.StringBuilder', expected: [text]},
  {name: 'uri-virtual', expression: 'new Uri("https://example.com/path?q=1")', owner: 'System.Uri',
    expected: ['https://example.com/path?q=1']}
];

function summary(samples, key) {
  const values = samples.map(sample => sample[key]).toSorted((left, right) => left - right);
  return {median: values[Math.floor(values.length / 2)], p95: values[Math.ceil(values.length * 0.95) - 1]};
}

function programFor(fixture) {
  const source = `using System;using System.Text;
    object value = ${fixture.expression};
    string start = "@start";string end = "@end";string result = "";
    Console.WriteLine(start);
    for(int index = 0;index < ${calls};index++) result = value.ToString();
    Console.WriteLine(end);Console.WriteLine(result);`;
  const program = compileToIL(source);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return program;
}

function sample(engine, program) {
  let vm, start, measurement;
  const onOutput = value => {
    if (value === '@start\n') {
      globalThis.gc?.();
      start = {allocatedBytes: vm.heap.stats.allocatedBytes, allocations: vm.heap.stats.allocations, time: performance.now()};
    } else if (value === '@end\n') {
      measurement = {elapsedMs: performance.now() - start.time,
        managedAllocations: vm.heap.stats.allocations - start.allocations,
        managedAllocatedBytes: vm.heap.stats.allocatedBytes - start.allocatedBytes};
    }
  };
  vm = engine === 'source' ? new VirtualMachine(program.image, {onOutput}) : new CilVirtualMachine(program.assembly, {onOutput});
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert(measurement, 'Both measurement markers must execute');
    return {...measurement, output: result.output.slice('@start\n@end\n'.length, -1)};
  } finally { vm.stop(); }
}

function measure(engine, fixture, program) {
  const enabled = fixture.owner && findContracts(fixture.owner, 'ToString').some(member => member.objectToStringOverride);
  const expected = fixture.owner && !enabled ? [fixture.owner] : fixture.expected;
  const samples = [];
  for (let index = -1; index < 5; index++) {
    const value = sample(engine, program);
    assert(expected.includes(value.output), `${fixture.name}: ${JSON.stringify(value.output)}`);
    if (index >= 0) samples.push(value);
  }
  assert(samples.every(value => value.output === samples[0].output));
  return {behavior: fixture.owner ? enabled ? 'framework override' : 'released type-name fallback' : 'released primitive profile',
    elapsedMs: summary(samples, 'elapsedMs'), managedAllocations: summary(samples, 'managedAllocations'), samples};
}

const engines = {source: {}, cil: {}};
for (const fixture of cases) {
  const program = programFor(fixture);
  for (const engine of Object.keys(engines)) engines[engine][fixture.name] = measure(engine, fixture, program);
}
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, length, warmups: 1, samples: 5,
  workload: 'Actual source/CIL compiled loops invoking Object.ToString through object references',
  notes: 'Compilation, VM/object setup and final output excluded. Loop and marker dispatch included. Managed allocation counters only.',
  baseline: '82ec8ed4; framework baseline returns type names, fixed branch returns values; primitive profile remains unchanged', engines}, null, 2));
