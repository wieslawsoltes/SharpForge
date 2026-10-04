import {createHash} from 'node:crypto';
import {verifiedStackBound} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {invokeManagedMethod} from '../src/execution/synchronous-call.js';
import {managedFixture} from '../../../tests/managed-fixtures.js';

// Match the existing cil-async.mjs sample policy; every measured callback starts unverified in a fresh VM.
const warmups = 80, samples = 24;
const bytes = managedFixture({methods: [
  {name: 'Main', body: writer => writer.op('ret')},
  {name: 'Callback', result: 'int', locals: ['int'], maxStack: 2,
    body(writer) {
      writer.mark('try').op('ldc.i4', 40).op('stloc.0').op('leave', 'done');
      writer.mark('handler').op('ldloc.0').op('ldc.i4.2').op('add').op('stloc.0').op('endfinally');
      writer.mark('done').op('ldloc.0').op('ret');
    },
    handlers(labels) {
      return [{flags: 2, start: labels.get('try'), end: labels.get('handler'),
        target: labels.get('handler'), handlerEnd: labels.get('done')}];
    }
  }
]});

function execute() {
  const before = performance.now();
  const vm = new CilVirtualMachine(bytes, {virtualTime: true});
  const ready = performance.now();
  try {
    const callback = [...vm.inspector.methods.values()].find(method => method.name === 'Callback');
    const originalReport = vm.report, caller = vm.top;
    if (vm.report.methods.includes(callback.token)) throw new Error('Callback was admitted before the measured operation');
    vm.state = 'paused';
    const invoking = performance.now();
    const result = invokeManagedMethod(vm.platform, callback.token, null, []);
    const finished = performance.now();
    if (result !== 42 || vm.state !== 'paused' || vm.top !== caller || vm.output.length) {
      throw new Error('Callback did not preserve its result, EH execution or paused caller');
    }
    if (vm.report === originalReport || !verifiedStackBound(vm.inspector, vm.report, vm.inspector.getMethod(callback.token)) ||
        !verifiedStackBound(vm.inspector, vm.report, caller.method)) throw new Error('Callback did not retain authentic stack proofs');
    if (vm.options.maxInstructions !== 20_000_000 || vm.scheduler.callbackScopes.length) {
      throw new Error('Callback changed the execution budget or leaked a callback scope');
    }
    const measurement = {admissionMs: ready - before, callbackMs: finished - invoking,
      totalMs: finished - before, allocatedBytes: vm.heap.stats.allocatedBytes, allocations: vm.heap.stats.allocations};
    if (Object.values(measurement).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      throw new Error('Callback timing and managed allocation measurements must be finite nonnegative numbers');
    }
    return measurement;
  } finally { vm.stop(); }
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]};
}

execute();
for (let index = 0; index < warmups; index++) execute();
const measurements = Array.from({length: samples}, execute);
console.log(JSON.stringify({head: process.env.SHARPFORGE_BENCH_REVISION,
  engine: 'JavaScript direct CIL interpreter', node: process.version, warmups, samples,
  cases: [{name: 'late-callback-finally', assemblySha256: createHash('sha256').update(bytes).digest('hex'),
    status: 'measured', samples: measurements, metrics: Object.fromEntries(Object.keys(measurements[0]).map(key =>
      [key, summarize(measurements.map(value => value[key]))]))}]}, null, 2));
