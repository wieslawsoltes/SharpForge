// node scripts/limited.js node --expose-gc scripts/benchmarks/a05-managed-object-string.mjs [calls=1000]
//   --mode baseline|candidate [--engine source|cil] [--case managed-override|primitive-control|framework-control|formatting-control]
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

let countArgument;
let mode = 'candidate';
let selectedEngine = null;
let selectedCase = null;
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--mode') mode = process.argv[++index];
  else if (argument === '--engine') selectedEngine = process.argv[++index];
  else if (argument === '--case') selectedCase = process.argv[++index];
  else {
    assert(countArgument === undefined && !argument.startsWith('--'), 'Expected one call count and optional --mode, --engine, --case');
    countArgument = argument;
  }
}
const calls = Number(countArgument ?? 1000);
const pipeline = 'legacy';
const warmups = 5;
const sampleCount = 9;
assert(Number.isSafeInteger(calls) && calls >= 100 && calls <= 100000);
assert(['baseline', 'candidate'].includes(mode), 'Mode must be baseline or candidate');
assert(selectedEngine === null || ['source', 'cil'].includes(selectedEngine), 'Engine must be source or cil');
const cases = [
  {name: 'managed-override', expression: 'new Value()', text: 'managed', override: true},
  {name: 'primitive-control', expression: '42', text: '42'},
  {name: 'framework-control', expression: 'new StringBuilder("framework")', text: 'framework'},
  {name: 'formatting-control', expression: 'new Value()', convert: true, text: 'Value'}
];
assert(selectedCase === null || cases.some(fixture => fixture.name === selectedCase), 'Case must name one workload');
const engineNames = selectedEngine === null ? ['source', 'cil'] : [selectedEngine];
const fixtures = selectedCase === null ? cases : cases.filter(fixture => fixture.name === selectedCase);
const sha256 = value => createHash('sha256').update(value).digest('hex');

function programFor(fixture) {
  const convert = fixture.convert ? 'Convert.ToString(value)' : 'value.ToString()';
  const declaration = fixture.override
    ? 'class Value { public override string ToString() { return "managed"; } }' : 'class Value {}';
  const source = `using System;using System.Text;
    ${declaration}
    class Program { static void Main() { object value = ${fixture.expression}; string result = "";
      Console.WriteLine("@start"); for (int index = 0; index < ${calls}; index++) result = ${convert};
      Console.WriteLine("@end"); Console.WriteLine(result); } }`;
  const program = compileToIL(source, {pipeline});
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return {...program, sourceSha256: sha256(source), assemblySha256: sha256(program.assembly)};
}

function sample(engine, fixture, program) {
  let vm, start, measured;
  const onOutput = text => {
    if (text === '@start\n') {
      globalThis.gc?.();
      start = {time: performance.now(), allocations: vm.heap.stats.allocations,
        bytes: vm.heap.stats.allocatedBytes, collections: vm.heap.stats.collections};
    } else if (text === '@end\n') measured = {milliseconds: performance.now() - start.time,
      allocations: vm.heap.stats.allocations - start.allocations, allocatedBytes: vm.heap.stats.allocatedBytes - start.bytes,
      collections: vm.heap.stats.collections - start.collections};
  };
  vm = engine === 'source' ? new VirtualMachine(program.image, {onOutput}) : new CilVirtualMachine(program.assembly, {onOutput});
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, `@start\n@end\n${fixture.text}\n`);
    return {...measured, output: fixture.text};
  } finally { vm.stop(); }
}

function summary(samples, key) {
  const values = samples.map(sample => sample[key]).sort((left, right) => left - right);
  return {median: values[Math.floor(values.length / 2)], p95: values[Math.ceil(values.length * 0.95) - 1]};
}

const engines = {};
for (const engine of engineNames) {
  engines[engine] = {};
  for (const fixture of fixtures) {
    if (mode === 'baseline' && fixture.override) {
      engines[engine][fixture.name] = {status: 'unsupported',
        reason: 'Managed override admission is unavailable in the baseline. This new workload runs only on the candidate.'};
      continue;
    }
    const program = programFor(fixture);
    const samples = [];
    const warmupSamples = [];
    for (let iteration = -warmups; iteration < sampleCount; iteration++) {
      const measurement = sample(engine, fixture, program);
      if (iteration >= 0) samples.push(measurement);
      else warmupSamples.push(measurement);
    }
    engines[engine][fixture.name] = {status: 'measured', behavior: samples[0].output,
      sourceSha256: program.sourceSha256, assemblySha256: program.assemblySha256,
      milliseconds: summary(samples, 'milliseconds'), allocations: summary(samples, 'allocations'),
      collections: summary(samples, 'collections'), warmupSamples, samples};
  }
}
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  mode, pipeline, calls, warmups, samples: sampleCount,
  selection: {engine: selectedEngine ?? 'all', case: selectedCase ?? 'all'},
  isolatedWorkload: selectedEngine !== null && selectedCase !== null, engines,
  notes: 'Compiled loops include dispatch and first-use verification; compilation/VM setup excluded. Unsupported baseline work has no timing.'}, null, 2));
