import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToAssembly} from '@sharpforge/compiler';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {createRegistry, types} from '@sharpforge/framework';
import {AssemblyInspector} from '@sharpforge/cil';

// Copy this identical file into each worktree; its static imports resolve that worktree's public package exports.
const usage = 'a07-readonly-field-loads.mjs --output PATH --mode baseline|candidate';
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (!['--output', '--mode'].includes(name) || !value) throw new Error(usage);
  options[name.slice(2)] = value;
}
if (!options.output || !['baseline', 'candidate'].includes(options.mode)) throw new Error(usage);
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fieldOwner = 'System.Diagnostics.ReadonlyFieldBenchmark';
const iterations = 20000;
const warmups = 3;
const sampleCount = 12;
const expected = BigInt(iterations) * 7n;
const previous = types.get(fieldOwner);
const registry = createRegistry();
registry.define(fieldOwner, {kind: 'bcl', fields: {
  Value: {type: 'long', isStatic: true, readOnly: true, value: {scalar: 'long', value: '7'}}
}});
types.set(fieldOwner, registry.frameworkType(fieldOwner));

function measure(external) {
  const source = `class FieldBenchmark {
    static long Value = 7L;
    public static long Run() {
      long sum = 0L;
      for (int index = 0; index < ${iterations}; index++) sum += ${external ? fieldOwner + '.Value' : 'Value'};
      return sum;
    }
  }`;
  const program = compileToAssembly(source, {name: 'FieldBenchmark', outputKind: 'library'});
  if (!program.success) throw new Error(JSON.stringify(program.diagnostics));
  const inspector = new AssemblyInspector(program.assembly);
  const method = [...inspector.methods.values()].find(value => value.owner === 'FieldBenchmark' && value.name === 'Run');
  if (inspector.getMethod(method.token).instructions.filter(instruction => instruction.name === 'ldsfld').length !== 1) {
    throw new Error('Benchmark must retain exactly one static load in the loop body');
  }
  const samples = [];
  for (let sample = 0; sample < warmups + sampleCount; sample++) {
    // Loading/admission is excluded. Each run gets fresh static slots and includes initial value setup and loop overhead.
    const vm = new CilVirtualMachine(inspector, {methodToken: method.token});
    try {
      const start = performance.now();
      const result = vm.run();
      samples.push(performance.now() - start);
      if (result.state !== 'terminated' || result.returnValue !== expected) throw new Error('Field benchmark result mismatch');
    } finally { vm.stop(); }
  }
  const sorted = samples.slice(warmups).sort((left, right) => left - right);
  const medianMs = (sorted[5] + sorted[6]) / 2;
  return {iterations, expected: expected.toString(), sourceSHA256: hash(source), assemblySHA256: hash(program.assembly),
    medianMs, p95Ms: sorted[Math.ceil(sampleCount * 0.95) - 1], nsPerLoad: medianMs * 1e6 / iterations, samples};
}

try {
  const results = {ordinaryStatic: measure(false)};
  results.registeredReadonly = options.mode === 'candidate' ? measure(true) : {status: 'unsupported-in-baseline'};
  const report = {workspace, mode: options.mode, node: process.version, platform: process.platform, arch: process.arch,
    cpu: cpus()[0]?.model, warmupSamples: warmups, sampleCount,
    scope: 'Whole direct-CIL loop execution; includes setup and interpreter overhead, excludes loading/admission.', results};
  writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  if (previous) types.set(fieldOwner, previous);
  else types.delete(fieldOwner);
}
