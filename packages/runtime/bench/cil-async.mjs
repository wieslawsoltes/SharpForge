import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from '../../../tests/managed-fixtures.js';

const warmups = 80, samples = 24;
const directory = process.argv[2];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const cases = [{name: 'ordinary-no-async', expected: {output: '', returnValue: 8256},
  bytes: managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int', 'int'],
  body(writer, context) {
    const absolute = context.member('System.Math', 'Abs', 'int', ['int']);
    writer.op('ldc.i4', 0).op('stloc.0').op('ldc.i4', 128).op('stloc.1');
    writer.mark('loop').op('ldloc.0').op('ldloc.1').op('neg').op('call', absolute).op('add').op('stloc.0');
    writer.op('ldloc.1').op('ldc.i4', 1).op('sub').op('dup').op('stloc.1').op('brtrue', 'loop');
    writer.op('ldloc.0').op('ret');
  }}]})}];
if (directory) {
  const capture = JSON.parse(readFileSync(join(directory, 'capture.json')));
  for (const fixture of ['Completed', 'Suspended']) for (const mode of ['Debug', 'Release']) {
    const bytes = new Uint8Array(readFileSync(join(directory, fixture + mode + '.dll')));
    const reference = capture.entries.find(entry => entry.name === fixture && entry.mode === mode);
    if (!reference || reference.assemblySha256 !== sha256(bytes)) throw new Error('Reference capture assembly hash mismatch');
    cases.push({name: fixture + '-' + mode, bytes, expected: {output: reference.output}});
  }
}

function execute(bytes, expected) {
  const before = performance.now();
  const vm = new CilVirtualMachine(bytes, {virtualTime: true});
  const ready = performance.now();
  try {
    let result = vm.run();
    for (let count = 0; count < 100 && result.state === 'waiting'; count++) {
      const delay = vm.scheduler.nextDelay();
      if (delay === null) throw new Error('Benchmark has no runnable continuation');
      vm.scheduler.advance(delay);
      result = vm.run();
    }
    if (result.state !== 'terminated') throw new Error(result.fault?.message ?? result.state);
    if (result.output !== expected.output || 'returnValue' in expected && result.returnValue !== expected.returnValue) {
      throw new Error('Benchmark execution did not match its captured output or ordinary control result');
    }
    const finished = performance.now();
    return {admissionMs: ready - before, executionMs: finished - ready,
      totalMs: finished - before, allocatedBytes: vm.heap.stats.allocatedBytes, allocations: vm.heap.stats.allocations};
  } finally {
    vm.stop();
  }
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]};
}

const result = {head: process.env.SHARPFORGE_BENCH_REVISION ?? execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  engine: 'JavaScript direct CIL interpreter', node: process.version, warmups, samples, cases: []};
for (const item of cases) {
  try {
    execute(item.bytes, item.expected);
  } catch (error) {
    if (item.name === 'ordinary-no-async' || error.name !== 'CilError' || !/verification failed/i.test(error.message)) throw error;
    result.cases.push({name: item.name, assemblySha256: sha256(item.bytes), status: 'rejected', error: error.message});
    continue;
  }
  for (let count = 0; count < warmups; count++) execute(item.bytes, item.expected);
  const measurements = Array.from({length: samples}, () => execute(item.bytes, item.expected));
  result.cases.push({name: item.name, assemblySha256: sha256(item.bytes), status: 'measured', samples: measurements, metrics: Object.fromEntries(
    Object.keys(measurements[0]).map(key => [key, summarize(measurements.map(value => value[key]))]))});
}
console.log(JSON.stringify(result, null, 2));
