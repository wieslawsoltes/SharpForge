import {createHash} from 'node:crypto';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from '../../../tests/managed-fixtures.js';
import {genericCallFixture} from '../../../tests/support/generic-call-fixture.js';

const warmups = 80;
const samples = 24;
const expected = {output: '', returnValue: 8256};
const options = {virtualTime: true, wasmTiering: false, maxInstructions: 100_000};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

const externalCalls = managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int', 'int'],
  body(writer, context) {
    const absolute = context.member('System.Math', 'Abs', 'int', ['int']);
    writer.op('ldc.i4', 0).op('stloc.0').op('ldc.i4', 128).op('stloc.1');
    writer.mark('loop').op('ldloc.0').op('ldloc.1').op('neg').op('call', absolute).op('add').op('stloc.0');
    writer.op('ldloc.1').op('ldc.i4', 1).op('sub').op('dup').op('stloc.1').op('brtrue', 'loop');
    writer.op('ldloc.0').op('ret');
  }
}]});

const localConstruction = genericCallFixture([
  {name: 'Cell', fields: [{name: 'Value', type: 'int'}], methods: [
    {name: '.ctor', flags: 0x1886, static: false, parameters: ['int'], body(writer, context) {
      writer.op('ldarg.0').op('call', context.member('System.Object', '.ctor', 'void', [], false));
      writer.op('ldarg.0').op('ldarg.1').op('stfld', context.fields.get('Cell.Value')).op('ret');
    }},
    {name: 'Read', static: false, result: 'int', body(writer, context) {
      writer.op('ldarg.0').op('ldfld', context.fields.get('Cell.Value')).op('ret');
    }}
  ]},
  {name: 'Program', methods: [{name: 'Main', result: 'int', locals: ['int', 'int'], body(writer, context) {
    writer.op('ldc.i4', 0).op('stloc.0').op('ldc.i4', 128).op('stloc.1');
    writer.mark('loop').op('ldloc.0').op('ldloc.1').op('newobj', context.methods.get('Cell..ctor'));
    writer.op('callvirt', context.methods.get('Cell.Read')).op('add').op('stloc.0');
    writer.op('ldloc.1').op('ldc.i4', 1).op('sub').op('dup').op('stloc.1').op('brtrue', 'loop');
    writer.op('ldloc.0').op('ret');
  }}]}
]);

const cases = [
  {name: 'external-only', bytes: externalCalls},
  {name: 'local-constructor-and-call', bytes: localConstruction}
];

function execute(bytes) {
  const start = performance.now();
  const vm = new CilVirtualMachine(bytes, options);
  const ready = performance.now();
  try {
    const result = vm.run();
    const end = performance.now();
    if (result.state !== 'terminated' || result.fault || result.output !== expected.output || result.returnValue !== expected.returnValue) {
      throw new Error(JSON.stringify({state: result.state, output: result.output,
        returnValue: result.returnValue, fault: result.fault?.message}));
    }
    const measurement = {
      admissionMs: ready - start,
      executionMs: end - ready,
      totalMs: end - start,
      instructions: result.stats.instructions,
      allocations: result.stats.heap.allocations,
      allocatedBytes: result.stats.heap.allocatedBytes
    };
    if (Object.values(measurement).some(value => !Number.isFinite(value) || value < 0)) {
      throw new Error('Benchmark timing or execution-count field is missing, negative or non-finite');
    }
    return measurement;
  } finally {
    vm.stop();
  }
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {median: (sorted[middle - 1] + sorted[middle]) / 2, p95: sorted[Math.ceil(sorted.length * 0.95) - 1]};
}

const report = {
  head: process.env.SHARPFORGE_BENCH_REVISION,
  engine: 'JavaScript direct CIL VM',
  node: process.version,
  v8: process.versions.v8,
  options,
  warmups,
  samples,
  cases: []
};

for (const entry of cases) {
  const assemblySha256 = digest(entry.bytes);
  const control = execute(entry.bytes);
  const guards = ['instructions', 'allocations', 'allocatedBytes'];
  function measure() {
    const result = execute(entry.bytes);
    if (digest(entry.bytes) !== assemblySha256 || guards.some(key => result[key] !== control[key])) {
      throw new Error('Benchmark assembly bytes or execution counts changed: ' + entry.name);
    }
    return result;
  }
  for (let count = 0; count < warmups; count++) measure();
  const measurements = Array.from({length: samples}, measure);
  report.cases.push({name: entry.name, assemblyBytes: entry.bytes.length, assemblySha256, expected,
    controls: Object.fromEntries(guards.map(key => [key, control[key]])), samples: measurements,
    metrics: Object.fromEntries(Object.keys(control).map(key => [key, summarize(measurements.map(value => value[key]))]))});
}

console.log(JSON.stringify(report, null, 2));
