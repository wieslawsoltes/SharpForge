// Copy this exact file to both worktrees. Run isolated --engine/--case processes serially in ABBA order.
// Existing controls for both engines finish before any new Boolean-field workload is compiled or run.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {dirname, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {compileToIL} from '@sharpforge/compiler';
import {serializeImage} from '@sharpforge/bytecode';
import {AssemblyInspector, MetadataBuilder, Writer, CilWriter, methodSignature, localSignature, fieldSignature,
  codedIndex, writePE, TEXT_RVA} from '@sharpforge/cil';
import {frameworkType} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const positional = [], options = {};
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument.startsWith('--')) {
    assert(['--engine', '--case'].includes(argument) && !(argument in options), 'Expected --engine/--case once each');
    const value = process.argv[++index];
    assert(value && !value.startsWith('--'), 'Selection flags require a value');
    options[argument] = value;
  } else {
    assert(positional.length < 2, 'Expected iteration count and revision label');
    positional.push(argument);
  }
}
const iterations = Number(positional[0] ?? 5000), revisionLabel = positional[1] ?? 'unspecified';
const warmups = 5, sampleCount = 9;
const selectedEngine = options['--engine'] ?? null, selectedCase = options['--case'] ?? null;
const controls = ['literalCold', 'literalLoop', 'staticStringLoop', 'readonlyScalarLoop', 'stringConstructorLoop', 'readonlyScalarFieldLoop'];
const cilOnlyControls = new Set(['stringConstructorLoop', 'readonlyScalarFieldLoop']);
const engineNames = selectedEngine === null ? ['source', 'cil'] : [selectedEngine];
assert(Number.isInteger(iterations) && iterations >= 100 && iterations <= 20000, 'Iterations must be within 100..20000');
assert(revisionLabel.length <= 120);
assert(selectedEngine === null || ['source', 'cil'].includes(selectedEngine));
assert(selectedCase === null || [...controls, 'readonlyStringLoop'].includes(selectedCase));
assert(!(selectedEngine === 'source' && cilOnlyControls.has(selectedCase)), 'Selected control requires --engine cil');
const runnerFile = fileURLToPath(import.meta.url), workspace = resolve(dirname(runnerFile), '../..');
const hash = value => createHash('sha256').update(value).digest('hex');

function constructorWorkload() {
  const md = new MetadataBuilder('StringConstructorControl'), resolveType = name => md.typeRef(name);
  const object = resolveType('System.Object'), string = resolveType('System.String');
  md.add(2, [0, md.string('<Module>'), 0, 0, 1, 1]);
  md.add(2, [0x100001, md.string('Program'), md.string('Fixture'), codedIndex('TypeDefOrRef', object), 1, 1]);
  const main = md.add(6, [0, 0, 0x96, md.string('Main'), md.blob(methodSignature('int', [], true, resolveType)), 1]);
  const locals = md.add(17, [md.blob(localSignature(['char[]', 'int', 'int'], resolveType))]);
  const constructor = md.member(string, '.ctor', methodSignature('void', ['char[]'], false, resolveType));
  const length = md.member(string, 'get_Length', methodSignature('int', [], false, resolveType));
  const writer = new CilWriter();
  writer.op('ldc.i4.0').op('newarr', resolveType('System.Char')).op('stloc.0').mark('loop')
    .op('ldloc.2').op('ldloc.0').op('newobj', constructor).op('callvirt', length).op('ldc.i4.1').op('add').op('add').op('stloc.2')
    .op('ldloc.1').op('ldc.i4.1').op('add').op('stloc.1').op('ldloc.1').op('ldc.i4', iterations).op('blt', 'loop')
    .op('ldloc.2').op('ret');
  const code = writer.finish(), section = new Writer().zero(72);
  section.pad(4);
  md.rows[6][0][0] = TEXT_RVA + section.length;
  section.u16(0x3013).u16(3).u32(code.length).u32(locals).bytes(code).pad(4);
  const metadataOffset = section.length, metadata = md.finish(undefined, code);
  section.bytes(metadata);
  const assembly = writePE(section.finish(), metadataOffset, metadata.length, main);
  return {source: null, program: {assembly}, image: null, literals: null, expected: iterations};
}

function scalarFieldWorkload() {
  const md = new MetadataBuilder('ReadonlyScalarFieldControl'), resolveType = name => md.typeRef(name);
  const object = resolveType('System.Object'), stopwatch = md.typeRef('System.Diagnostics.Stopwatch', 'System.Runtime');
  md.add(2, [0, md.string('<Module>'), 0, 0, 1, 1]);
  md.add(2, [0x100001, md.string('Program'), md.string('Fixture'), codedIndex('TypeDefOrRef', object), 1, 1]);
  const main = md.add(6, [0, 0, 0x96, md.string('Main'), md.blob(methodSignature('int', [], true, resolveType)), 1]);
  const locals = md.add(17, [md.blob(localSignature(['int', 'long'], resolveType))]);
  const frequency = md.member(stopwatch, 'Frequency', fieldSignature('long', resolveType));
  const writer = new CilWriter();
  writer.mark('loop').op('ldloc.1').op('ldsfld', frequency).op('add').op('stloc.1')
    .op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0').op('ldloc.0').op('ldc.i4', iterations).op('blt', 'loop')
    .op('ldloc.1').op('ldc.i8', BigInt(iterations) * 1_000_000_000n).op('ceq').op('ret');
  const code = writer.finish(), section = new Writer().zero(72);
  section.pad(4);
  md.rows[6][0][0] = TEXT_RVA + section.length;
  section.u16(0x3013).u16(2).u32(code.length).u32(locals).bytes(code).pad(4);
  const metadataOffset = section.length, metadata = md.finish(undefined, code);
  section.bytes(metadata);
  const assembly = writePE(section.finish(), metadataOffset, metadata.length, main);
  const inspector = new AssemblyInspector(assembly);
  const loads = inspector.getMethod(main).instructions.filter(instruction => instruction.name === 'ldsfld');
  assert.equal(loads.length, 1);
  const field = inspector.resolveToken(loads[0].operand);
  assert.deepEqual([field.owner, field.name, field.signature.type], ['System.Diagnostics.Stopwatch', 'Frequency', 'long']);
  return {source: null, program: {assembly}, image: null, literals: null, expected: 1};
}

function compileWorkload(name) {
  if (name === 'stringConstructorLoop') return constructorWorkload();
  if (name === 'readonlyScalarFieldLoop') return scalarFieldWorkload();
  let source = 'class Program { static void Main() {} }', expected = iterations * 7;
  if (name !== 'literalCold') {
    const numeric = name === 'readonlyScalarLoop';
    const target = name === 'literalLoop' ? '"literal".Length' : name === 'staticStringLoop' ? 'Value.Length' :
      name === 'readonlyStringLoop' ? 'System.Boolean.TrueString.Length' : 'System.Diagnostics.Stopwatch.Frequency';
    const result = numeric ? `sum == ${iterations}L * 1000000000L ? 42 : 0` : 'sum';
    source = `class Program { static string Value = "literal"; static int Main() {
      ${numeric ? 'long sum = 0L' : 'int sum = 0'};
      for (int index = 0; index < ${iterations}; index++) sum += ${target};
      return ${result};
    } }`;
    expected = numeric ? 42 : iterations * (name === 'readonlyStringLoop' ? 4 : 7);
  }
  const program = compileToIL(source);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  const literals = name === 'literalCold' ? Array.from({length: iterations}, (_, index) => 'cold literal ' + index) : null;
  const offset = program.image.constants.length;
  const image = literals ? {...program.image, constants: [...program.image.constants, ...literals]} : program.image;
  if (name === 'readonlyStringLoop') {
    const inspector = new AssemblyInspector(program.assembly);
    const fields = [...inspector.methods.values()].flatMap(method => inspector.getMethod(method.token).instructions)
      .filter(instruction => instruction.name === 'ldsfld').map(instruction => inspector.resolveToken(instruction.operand));
    assert(fields.some(field => field.owner === 'System.Boolean' && field.name === 'TrueString'));
  }
  return {source, program, image, literals, offset, expected};
}

function summarize(values) {
  const sorted = values.toSorted((left, right) => left - right), middle = Math.floor(sorted.length / 2);
  return {median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]};
}

function measure(engine, name) {
  const workload = compileWorkload(name), samples = [];
  for (let sample = -warmups; sample < sampleCount; sample++) {
    const vm = engine === 'source' ? new VirtualMachine(workload.image) : new CilVirtualMachine(workload.program.assembly);
    const values = workload.literals ? Array(iterations) : null;
    try {
      globalThis.gc?.();
      const before = {...vm.heap.stats}, started = performance.now();
      let execution;
      if (values) {
        for (let index = 0; index < iterations; index++) {
          values[index] = engine === 'source' ? vm.constant(workload.offset + index) : vm.string(workload.literals[index]);
        }
      } else execution = vm.run();
      const elapsedMs = performance.now() - started;
      const result = {elapsedMs, nanosecondsPerIteration: elapsedMs * 1_000_000 / iterations,
        managedAllocations: vm.heap.stats.allocations - before.allocations,
        managedAllocatedBytes: vm.heap.stats.allocatedBytes - before.allocatedBytes,
        managedCollections: vm.heap.stats.collections - before.collections};
      if (values) {
        for (let index = 0; index < iterations; index++) assert.equal(vm.value(values[index]), workload.literals[index]);
        assert.equal(result.managedAllocations, iterations);
      } else {
        assert.equal(execution.state, 'terminated', execution.fault?.stack);
        assert.equal(vm.value(vm.returnValue), workload.expected);
        if (name === 'stringConstructorLoop') assert.equal(result.managedAllocations, 2, 'One array and one cold empty string');
        if (name === 'readonlyScalarFieldLoop') assert.equal(result.managedAllocations, 0, 'Scalar fields do not allocate managed objects');
      }
      if (sample >= 0) samples.push(result);
    } finally { vm.stop(); }
  }
  return {iterations, sourceSha256: workload.source === null ? null : hash(workload.source),
    assemblySha256: hash(workload.program.assembly), imageSha256: workload.image === null ? null : hash(serializeImage(workload.image)), samples,
    ...Object.fromEntries(Object.keys(samples[0]).map(key => [key, summarize(samples.map(sample => sample[key]))]))};
}

const engines = {}, executionOrder = [];
for (const engine of engineNames) {
  const results = {};
  for (const name of controls) {
    if (cilOnlyControls.has(name) && engine !== 'cil') continue;
    if (selectedCase !== null && selectedCase !== name) continue;
    executionOrder.push({engine, case: name, group: 'controls'});
    results[name] = measure(engine, name);
  }
  engines[engine] = {controls: results};
}
for (const engine of engineNames) {
  if (selectedCase !== null && selectedCase !== 'readonlyStringLoop') continue;
  if (frameworkType('System.Boolean')?.fields?.TrueString?.type !== 'string') {
    engines[engine].readonlyStringLoop = {skipped: true, reason: 'Readonly string fields are absent on baseline'};
    continue;
  }
  executionOrder.push({engine, case: 'readonlyStringLoop', group: 'newFields'});
  engines[engine].readonlyStringLoop = measure(engine, 'readonlyStringLoop');
}
console.log(JSON.stringify({revisionLabel,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: workspace, encoding: 'utf8'}).trim(),
  runnerSha256: hash(readFileSync(runnerFile)), node: process.version, platform: process.platform, arch: process.arch,
  cpu: cpus()[0]?.model, gcAvailable: typeof globalThis.gc === 'function', iterations, warmups, samples: sampleCount,
  selection: {engine: selectedEngine ?? 'all', case: selectedCase ?? 'all'},
  isolatedWorkload: selectedEngine !== null && selectedCase !== null, executionOrder,
  notes: 'Setup, compilation, admission, explicit host GC and checks are excluded; automatic managed GC is measured. ' +
    'Loop cases include interpreter overhead and first initialization; literalCold directly reads distinct literals on a fresh VM. ' +
    'The independent CIL stringConstructorLoop reuses one empty char array, with one cold string initialization followed by warm pool hits. ' +
    'readonlyScalarLoop measures compiled CONST/ldc.i8 constants; independent CIL readonlyScalarFieldLoop repeatedly executes genuine ldsfld.',
  engines}, null, 2));
