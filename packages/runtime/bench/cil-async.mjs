import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from '../../../tests/managed-fixtures.js';

const warmups = 80, samples = 24;
const directory = process.argv[2];
const cases = [{name: 'ordinary-no-async', bytes: managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int', 'int'],
  body(writer, context) {
    const absolute = context.member('System.Math', 'Abs', 'int', ['int']);
    writer.op('ldc.i4', 0).op('stloc.0').op('ldc.i4', 128).op('stloc.1');
    writer.label('loop').op('ldloc.0').op('ldloc.1').op('neg').op('call', absolute).op('add').op('stloc.0');
    writer.op('ldloc.1').op('ldc.i4', 1).op('sub').op('dup').op('stloc.1').op('brtrue', 'loop');
    writer.op('ldloc.0').op('ret');
  }}]})}];
if (directory) {
  for (const fixture of ['Completed', 'Suspended']) for (const mode of ['Debug', 'Release']) {
    cases.push({name: fixture + '-' + mode, bytes: new Uint8Array(readFileSync(join(directory, fixture + mode + '.dll')))});
  }
}

function execute(bytes) {
  const before = performance.now();
  const vm = new CilVirtualMachine(bytes, {virtualTime: true});
  const ready = performance.now();
  let result = vm.run();
  for (let count = 0; count < 100 && result.state === 'waiting'; count++) {
    const delay = vm.scheduler.nextDelay();
    if (delay === null) throw new Error('Benchmark has no runnable continuation');
    vm.scheduler.advance(delay);
    result = vm.run();
  }
  if (result.state !== 'terminated') throw new Error(result.fault?.message ?? result.state);
  return {admissionMs: ready - before, executionMs: performance.now() - ready,
    totalMs: performance.now() - before, allocatedBytes: vm.heap.stats.allocatedBytes, allocations: vm.heap.stats.allocations};
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {median: (sorted[11] + sorted[12]) / 2, p95: sorted[Math.ceil(sorted.length * 0.95) - 1]};
}

const result = {head: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  engine: 'JavaScript direct CIL interpreter', node: process.version, warmups, samples, cases: []};
for (const item of cases) {
  try {
    execute(item.bytes);
  } catch (error) {
    result.cases.push({name: item.name, status: 'rejected', error: error.message});
    continue;
  }
  for (let count = 0; count < warmups; count++) execute(item.bytes);
  const measurements = Array.from({length: samples}, () => execute(item.bytes));
  result.cases.push({name: item.name, status: 'measured', metrics: Object.fromEntries(
    Object.keys(measurements[0]).map(key => [key, summarize(measurements.map(value => value[key]))]))});
}
console.log(JSON.stringify(result, null, 2));
