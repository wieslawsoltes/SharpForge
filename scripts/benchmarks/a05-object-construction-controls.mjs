// Copy this identical runner into each worktree; static public imports select that worktree's implementation.
// node scripts/limited.js node --expose-gc scripts/benchmarks/a05-object-construction-controls.mjs
//   --mode baseline|candidate --engine source|cil --case arithmetic-control|user-construction-control --output PATH
// Optional --iterations N defaults to 5000. Omit engine/case only for an explicitly mixed workload report.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {dirname, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';

const options = {mode: 'candidate', engine: 'all', case: 'all', iterations: '5000'};
const names = new Set(['--mode', '--engine', '--case', '--iterations', '--output']);
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  assert(names.has(name) && value !== undefined && !value.startsWith('--'), 'Expected a recognized option and value');
  options[name.slice(2)] = value;
}
const iterations = Number(options.iterations), warmups = 5, sampleCount = 9, pipeline = 'legacy';
assert(Number.isSafeInteger(iterations) && iterations >= 100 && iterations <= 100000, 'Iterations must be 100..100000');
assert(['baseline', 'candidate'].includes(options.mode), 'Mode must be baseline or candidate');
assert(['all', 'source', 'cil'].includes(options.engine), 'Engine must be source or cil');
const cases = [
  {name: 'arithmetic-control', statement: 'sum += current;', allocations: 0},
  {name: 'user-construction-control', statement: 'Cell value = new Cell(current); sum += value.Value;', allocations: iterations}
];
assert(options.case === 'all' || cases.some(fixture => fixture.name === options.case), 'Case must name one control');
const selectedCases = cases.filter(fixture => options.case === 'all' || fixture.name === options.case);
const selectedEngines = options.engine === 'all' ? ['source', 'cil'] : [options.engine];
const expected = String(Math.floor(iterations / 8) * 28 + (iterations % 8) * (iterations % 8 - 1) / 2) + '\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const file = fileURLToPath(import.meta.url), workspace = resolve(dirname(file), '../..');

function programFor(fixture) {
  const source = `using System;
    class Cell { public int Value; public Cell(int value) { Value = value; } }
    class Program { static void Main() {
      int sum = 0;
      for (int index = 0; index < ${iterations}; index++) {
        int current = index & 7; ${fixture.statement}
      }
      Console.WriteLine(sum);
    } }`;
  const program = compileToIL(source, {name: 'ObjectConstructionControls', pipeline});
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return {...program, source, sourceSha256: hash(source), assemblySha256: hash(program.assembly)};
}

function sample(engine, fixture, program) {
  globalThis.gc?.();
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  try {
    const before = {...vm.heap.stats}, instructions = vm.instructions;
    const start = performance.now();
    const result = vm.run();
    const milliseconds = performance.now() - start;
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, expected, fixture.name + '/' + engine);
    const allocations = vm.heap.stats.allocations - before.allocations;
    assert.equal(allocations, fixture.allocations, 'Each user constructor must allocate exactly once; arithmetic must allocate nothing');
    return {milliseconds, allocations, allocatedBytes: vm.heap.stats.allocatedBytes - before.allocatedBytes,
      collections: vm.heap.stats.collections - before.collections, instructions: vm.instructions - instructions,
      output: result.output};
  } finally { vm.stop(); }
}

function distribution(samples, key) {
  const values = samples.map(sample => sample[key]).sort((left, right) => left - right);
  return {median: values[Math.floor(values.length / 2)], p95: values[Math.ceil(values.length * 0.95) - 1]};
}

const results = [];
for (const fixture of selectedCases) {
  const program = programFor(fixture);
  for (const engine of selectedEngines) {
    const warmupSamples = [], samples = [];
    for (let index = 0; index < warmups + sampleCount; index++) {
      const measurement = sample(engine, fixture, program);
      (index < warmups ? warmupSamples : samples).push(measurement);
    }
    results.push({case: fixture.name, engine, source: program.source, sourceSha256: program.sourceSha256,
      assemblySha256: program.assemblySha256, expectedOutput: expected, outputSha256: hash(expected),
      milliseconds: distribution(samples, 'milliseconds'), allocations: distribution(samples, 'allocations'),
      allocatedBytes: distribution(samples, 'allocatedBytes'), collections: distribution(samples, 'collections'),
      instructions: distribution(samples, 'instructions'), warmupSamples, samples});
  }
}

const report = {schemaVersion: 1, benchmark: 'Object construction controls', workspace,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: workspace, encoding: 'utf8'}).trim(), runnerSha256: hash(readFileSync(file)),
  node: process.version, nodeArguments: process.execArgv, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  mode: options.mode, pipeline, iterations, warmups, sampleCount, hostGcBeforeEachVm: typeof globalThis.gc === 'function',
  selection: {case: options.case, engine: options.engine}, isolatedWorkload: options.case !== 'all' && options.engine !== 'all',
  scope: 'Whole VM execution: loop arithmetic, field access, constructor bodies, dispatch and managed GC; compilation/loading excluded.',
  comparison: 'Use identical runner/source/assembly hashes, fresh per-case/per-engine processes, and counterbalanced revision order.',
  results};
const json = JSON.stringify(report, null, 2) + '\n';
if (options.output) {
  mkdirSync(dirname(resolve(options.output)), {recursive: true});
  writeFileSync(options.output, json);
}
console.log(json.trimEnd());
