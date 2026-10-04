import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {disassemble, frameworkBuiltin} from '@sharpforge/bytecode';
import {MAX} from '@sharpforge/bcl-core';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderContract, builderPlatform, units} from './fixtures/string-builder/append-char.js';
import {createInsertBuilder} from './fixtures/string-builder/insert-char.js';
import {insertRepeatParameters, builderInsertRepeatSource, builderInsertRepeatAssembly,
  repeatedInsertionFluentSource} from './fixtures/string-builder/insert-repeat.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-insert-repeat-net10.json', directory), 'utf8'));
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const programs = new Map();
function compile(source, pipeline) {
  const key = pipeline + source;
  if (!programs.has(key)) {
    const program = compileToIL('using System;using System.Text;' + source, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    programs.set(key, program);
  }
  return programs.get(key);
}
function fault(error, row) {
  assert.equal(error.name, row.fault, row.id);
  if (row.parameter) assert(error.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + error.message);
  return true;
}
function content(platform, reference) {
  return reference === null ? null : units(platform.native(platform.invoke(builderContract('ToString'), [reference])));
}
function withBuilder(engine, row, action) {
  const runner = builderPlatform(engine, '');
  try {
    runner.platform.heap.withRoots([], () => action({...runner, reference: createInsertBuilder(runner.platform, row)}));
    assert.equal(runner.platform.heap.pins.length, 0);
  } finally {runner.stop();}
}
function managedValue(platform, value) {
  if (value === null) return null;
  const reference = platform.heap.string(String.fromCharCode(...value));
  platform.heap.pins.push(reference);
  return reference;
}
const metadata = (platform, reference) => ['$data', '$count', '$length', '$capacity', '$version'].map(key => platform.get(reference, key));
const invoke = (platform, reference, args) => platform.invoke(builderContract('Insert', insertRepeatParameters), [reference, ...args]);

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`StringBuilder.Insert repeat ${pipeline}/${engine}: native successful text and exact contract selection`, () => {
      const rows = native.rows.filter(row => !row.fault);
      const program = compile(rows.map(builderInsertRepeatSource).join('\n'), pipeline);
      const id = frameworkBuiltin(builderContract('Insert', insertRepeatParameters)).id;
      assert(disassemble(program.image).flatMap(method => method.instructions).some(item => item.op === 'BUILTIN' && item.a === id));
      const vm = create(program);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nTrue\n'.repeat(rows.length));
      } finally {vm.stop();}
    });
    test(`StringBuilder.Insert repeat ${pipeline}/${engine}: receiver/count/index precedence`, () => {
      for (const id of ['null-null-value-both-negative', 'flat-text-value-both-negative', 'flat-null-value-negative-zero',
        'empty-empty-value-past-one', 'flat-text-value-negative-count', 'flat-text-value-both-minimum',
        'flat-text-negative-maximum-count']) {
        const row = native.rows.find(value => value.id === id);
        const vm = create(compile(builderInsertRepeatSource(row), pipeline));
        try {
          const result = vm.run();
          assert.equal(result.state, 'faulted', id);
          fault(result.fault, row);
        } finally {vm.stop();}
      }
    });
    test(`StringBuilder.Insert repeat ${pipeline}/${engine}: receiver/index/string/count evaluate once`, () => {
      const vm = create(compile(repeatedInsertionFluentSource, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, native.fluent.calls + '\n' + String.fromCharCode(...native.fluent.text) +
          '\n' + native.fluent.length + '\nTrue\n');
      } finally {vm.stop();}
    });
  }
  test(`StringBuilder.Insert repeat ${engine}: all native results and faults retain the existing string storage profile`, () => {
    for (const row of native.rows) withBuilder(engine, row, ({platform, reference}) => {
      const value = managedValue(platform, row.value);
      const before = reference === null ? null : metadata(platform, reference);
      const call = () => invoke(platform, reference, [row.index, value, row.count]);
      if (row.fault) assert.throws(call, error => fault(error, row));
      else assert.deepEqual(call(), reference, row.id);
      if (reference !== null) {
        assert.equal(platform.get(reference, '$length'), row.after.length, row.id);
        assert.equal(platform.get(reference, '$capacity'), Math.max(before[3], row.after.length), row.id);
        if (row.fault || row.count === 0 || !row.value?.length) assert.deepEqual(metadata(platform, reference), before, row.id);
      }
      assert.deepEqual(content(platform, reference), row.after?.text ?? null, row.id);
    });
  });
  test(`StringBuilder.Insert repeat ${engine}: successful null/empty/zero calls require no chunk reads, writes or managed budget`, () => {
    const rows = native.rows.filter(row => !row.fault && (row.count === 0 || !row.value?.length));
    for (const row of rows) withBuilder(engine, row, ({platform, vm, reference}) => {
      const {heap} = platform;
      const value = managedValue(platform, row.value);
      const storage = platform.get(reference, '$data');
      const records = storage ? heap.get(storage).data.filter(Boolean).map(item => heap.get(item)) : [];
      const descriptors = records.map(record => Object.getOwnPropertyDescriptor(record, 'data'));
      let reads = 0, writes = 0;
      records.forEach((record, index) => Object.defineProperty(record, 'data', {
        configurable: true, get() {reads++; return descriptors[index].value;}
      }));
      const before = [metadata(platform, reference), heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision];
      const budget = heap.maxBytes;
      vm.onWrite = () => {writes++;};
      try {
        heap.maxBytes = 1;
        assert.deepEqual(invoke(platform, reference, [row.index, value, row.count]), reference);
        assert.equal(reads, 0);
        assert.equal(writes, 0);
        assert.deepEqual([metadata(platform, reference), heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision], before);
      } finally {
        heap.maxBytes = budget;
        vm.onWrite = null;
        records.forEach((record, index) => Object.defineProperty(record, 'data', descriptors[index]));
      }
    });
  });
  test(`StringBuilder.Insert repeat ${engine}: output limits precede repeat allocation and include existing text`, () => {
    const row = native.rows.find(value => value.id === 'flat-text-value-middle-1');
    withBuilder(engine, row, ({platform, reference}) => {
      const value = managedValue(platform, units('ab'));
      const before = metadata(platform, reference);
      const allocations = platform.heap.stats.allocations;
      for (const count of [MAX / 2, 2147483647]) {
        assert.throws(() => invoke(platform, reference, [1, value, count]), {name: 'OutOfMemoryException'});
        assert.deepEqual(metadata(platform, reference), before);
        assert.equal(platform.heap.stats.allocations, allocations);
      }
      assert.deepEqual(invoke(platform, reference, [1, value, (MAX - 2) / 2]), reference);
      assert.equal(platform.get(reference, '$length'), MAX);
    });
  });
  test(`StringBuilder.Insert repeat ${engine}: invalid arguments and first-allocation failure leave chunks unchanged`, () => {
    const row = native.rows.find(value => value.id === 'chunks-text-value-middle-3');
    withBuilder(engine, row, ({platform, reference}) => {
      const {heap} = platform;
      const value = managedValue(platform, row.value);
      const before = metadata(platform, reference);
      const chunks = [...heap.get(before[0]).data];
      const budget = heap.maxBytes;
      try {
        heap.maxBytes = 1;
        assert.throws(() => invoke(platform, reference, [-1, value, -1]), error => fault(error,
          {id: 'count before index', fault: 'ArgumentOutOfRangeException', parameter: 'count'}));
        assert.throws(() => invoke(platform, reference, [row.index, value, row.count]), {name: 'OutOfMemoryException'});
      } finally {heap.maxBytes = budget;}
      assert.deepEqual(metadata(platform, reference), before);
      assert.deepEqual(heap.get(before[0]).data, chunks);
      assert.deepEqual(content(platform, reference), row.before.text);
    });
  });
  test(`StringBuilder.Insert repeat ${engine}: one result allocation survives observer GC and snapshot restoration`, () => {
    const row = native.rows.find(value => value.id === 'chunks-text-value-middle-3');
    withBuilder(engine, row, ({platform, vm, reference}) => {
      const {heap} = platform;
      const value = managedValue(platform, row.value);
      const snapshot = heap.snapshot();
      const allocations = heap.stats.allocations;
      const pins = heap.pins.length;
      vm.onWrite = () => {heap.collect(); assert.equal(platform.native(value), String.fromCharCode(...row.value));};
      try {invoke(platform, reference, [row.index, value, row.count]);}
      finally {vm.onWrite = null;}
      assert.equal(heap.stats.allocations - allocations, 1);
      assert.equal(heap.pins.length, pins);
      assert.deepEqual(content(platform, reference), row.after.text);
      heap.restore(snapshot);
      assert.deepEqual(content(platform, reference), row.before.text);
    });
  });
  test(`StringBuilder.Insert repeat ${engine}: observer faults match released string insertion partial progress`, () => {
    const row = native.rows.find(value => value.id === 'chunks-text-value-middle-3');
    withBuilder(engine, row, ({platform, vm, reference}) => {
      const {heap} = platform;
      const value = managedValue(platform, row.value);
      const expanded = heap.string(String.fromCharCode(...row.value).repeat(row.count));
      heap.pins.push(expanded);
      const snapshot = heap.snapshot();
      const pins = heap.pins.length;
      for (const property of ['$count', '$version', '$length', '$capacity']) {
        const states = [];
        const failure = new Error('observer stop');
        for (const repeated of [true, false]) {
          heap.restore(snapshot);
          vm.onWrite = event => {if (event.property === property) {heap.collect(); throw failure;}};
          try {
            assert.throws(() => repeated ? invoke(platform, reference, [row.index, value, row.count])
              : platform.invoke(builderContract('Insert', ['int', 'string']), [reference, row.index, expanded]), error => error === failure);
          } finally {vm.onWrite = null;}
          assert.equal(heap.pins.length, pins);
          states.push({metadata: metadata(platform, reference), text: content(platform, reference)});
        }
        assert.deepEqual(states[0], states[1], property);
      }
    });
  });
}

test('StringBuilder.Insert repeat: independent CIL executes every native row with exact signature and faults', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderInsertRepeatAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) fault(result.fault, row);
      else assert.equal(Boolean(vm.statics.get(0x04000002)), true, row.id);
      assert.deepEqual(content(vm.platform, vm.statics.get(0x04000001)), row.after?.text ?? null, row.id);
    } finally {vm.stop();}
  }
});

test('StringBuilder.Insert repeat: native provenance, safe corpus and stable ordered ABI', () => {
  const source = readFileSync(new URL('string-builder-insert-repeat/Program.cs', directory));
  assert.equal(native.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.rows.length, 206);
  assert.equal(builderContract('Insert', ['int', 'string']).id, 814);
  assert.equal(builderContract('Insert', ['int', 'char']).id, 524336);
  assert.equal(builderContract('Insert', ['int', 'bool']).id, 524338);
  assert.equal(builderContract('Insert', insertRepeatParameters).id, 524339);
  for (const row of native.rows) {
    if (!row.fault && row.value?.length) assert(row.count <= 17, row.id);
    if (row.fault) assert.deepEqual(row.after, row.before, row.id);
  }
  assert.equal(native.fluent.calls, 1234);
  assert.equal(native.fluent.identity, true);
});
