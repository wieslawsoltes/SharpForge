import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderContract, builderPlatform, units} from './fixtures/string-builder/append-char.js';
import {createEditBuilder} from './fixtures/string-builder/replace-char.js';
import {builderRemoveSource, builderRemoveAssembly} from './fixtures/string-builder/remove.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-remove-net10.json', directory), 'utf8'));
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
function withBuilder(engine, segments, action) {
  const runner = builderPlatform(engine, '');
  try {
    runner.platform.heap.withRoots([], () => action({...runner, reference: createEditBuilder(runner.platform, segments)}));
    assert.equal(runner.platform.heap.pins.length, 0);
  } finally {runner.stop();}
}
const state = (platform, reference) => ['$data', '$count', '$length', '$capacity', '$version'].map(key => platform.get(reference, key));
const remove = (platform, reference, start, length) => platform.invoke(builderContract('Remove', ['int', 'int']),
  [reference, start, length]);

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`StringBuilder.Remove ${pipeline}/${engine}: native successful text and fluent identity`, () => {
      const rows = native.rows.filter(row => !row.fault);
      const vm = create(compile(rows.map(builderRemoveSource).join('\n'), pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nTrue\n'.repeat(rows.length));
      } finally {vm.stop();}
    });
    test(`StringBuilder.Remove ${pipeline}/${engine}: native competing fault precedence`, () => {
      for (const id of ['null-both-negative', 'flat-both-negative', 'flat-past-negative', 'flat-negative-start',
        'flat-negative-length', 'empty-past-zero', 'flat-minimum-start', 'flat-maximum-start-zero']) {
        const row = native.rows.find(value => value.id === id);
        const vm = create(compile(builderRemoveSource(row), pipeline));
        try {
          const result = vm.run();
          assert.equal(result.state, 'faulted', id);
          fault(result.fault, row);
        } finally {vm.stop();}
      }
    });
  }
  test(`StringBuilder.Remove ${engine}: every native result with the released runtime capacity policy`, () => {
    for (const row of native.rows) withBuilder(engine, row.segments, ({platform, reference}) => {
      const before = reference === null ? null : state(platform, reference);
      const invoke = () => remove(platform, reference, row.start, row.length);
      if (row.fault) assert.throws(invoke, error => fault(error, row));
      else assert.deepEqual(invoke(), reference, row.id);
      if (reference !== null) {
        assert.equal(platform.get(reference, '$length'), row.after.length, row.id);
        assert.equal(platform.get(reference, '$capacity'), before[3], row.id);
        if (row.fault || row.length === 0) assert.deepEqual(state(platform, reference), before, row.id);
      }
      assert.deepEqual(content(platform, reference), row.after?.text ?? null, row.id);
    });
  });
  test(`StringBuilder.Remove ${engine}: valid zero ranges preserve chunks without allocation, reads or writes`, () => {
    for (const segments of [[], ['abc', '\0\ud800', '\udc00xyz'].map(units)]) withBuilder(engine, segments, ({platform, vm, reference}) => {
      const {heap} = platform;
      const storage = platform.get(reference, '$data');
      const chunks = storage ? [...heap.get(storage).data] : [];
      const records = chunks.filter(Boolean).map(value => heap.get(value));
      const descriptors = records.map(record => Object.getOwnPropertyDescriptor(record, 'data'));
      const before = [state(platform, reference), heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision];
      const budget = heap.maxBytes;
      let writes = 0, reads = 0;
      records.forEach((record, index) => Object.defineProperty(record, 'data', {
        configurable: true, get() {reads++; return descriptors[index].value;}
      }));
      vm.onWrite = () => {writes++;};
      try {
        heap.maxBytes = 1;
        for (const start of [0, platform.get(reference, '$length')]) assert.deepEqual(remove(platform, reference, start, 0), reference);
        assert.equal(reads, 0);
        assert.equal(writes, 0);
        assert.deepEqual([state(platform, reference), heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision], before);
        if (storage) assert.deepEqual(heap.get(storage).data, chunks);
      } finally {
        heap.maxBytes = budget;
        vm.onWrite = null;
        records.forEach((record, index) => Object.defineProperty(record, 'data', descriptors[index]));
      }
    });
  });
  test(`StringBuilder.Remove ${engine}: argument faults precede chunk reads and cannot mutate state`, () => {
    withBuilder(engine, ['abc', 'def'].map(units), ({platform, reference}) => {
      const {heap} = platform;
      const record = heap.get(heap.get(platform.get(reference, '$data')).data[0]);
      const descriptor = Object.getOwnPropertyDescriptor(record, 'data');
      const before = [state(platform, reference), heap.stats.allocations, heap.mutationRevision];
      let reads = 0;
      Object.defineProperty(record, 'data', {configurable: true, get() {reads++; return descriptor.value;}});
      try {
        for (const [start, length, parameter] of [[-1, -1, 'length'], [7, 0, 'length'], [-1, 0, 'startIndex'], [0, 7, 'length']]) {
          assert.throws(() => remove(platform, reference, start, length), error => fault(error,
            {id: `${start}/${length}`, fault: 'ArgumentOutOfRangeException', parameter}));
        }
        assert.equal(reads, 0);
        assert.deepEqual([state(platform, reference), heap.stats.allocations, heap.mutationRevision], before);
      } finally {Object.defineProperty(record, 'data', descriptor);}
    });
  });
  test(`StringBuilder.Remove ${engine}: result allocation failure preserves the existing storage`, () => {
    withBuilder(engine, ['abc', 'def'].map(units), ({platform, reference}) => {
      const {heap} = platform;
      const before = state(platform, reference);
      const chunks = [...heap.get(before[0]).data];
      const budget = heap.maxBytes;
      heap.collect();
      try {
        heap.maxBytes = heap.stats.liveBytes;
        assert.throws(() => remove(platform, reference, 1, 3), {name: 'OutOfMemoryException'});
      } finally {heap.maxBytes = budget;}
      assert.deepEqual(state(platform, reference), before);
      assert.deepEqual(heap.get(before[0]).data, chunks);
      assert.deepEqual(content(platform, reference), units('abcdef'));
    });
  });
  test(`StringBuilder.Remove ${engine}: existing commit survives observer GC, snapshot restore and subsequent Append`, () => {
    withBuilder(engine, ['abc', 'def', 'ghi'].map(units), ({platform, vm, reference}) => {
      const snapshot = platform.heap.snapshot();
      vm.onWrite = () => {platform.heap.collect();};
      try {assert.deepEqual(remove(platform, reference, 2, 5), reference);}
      finally {vm.onWrite = null;}
      assert.deepEqual(content(platform, reference), units('abhi'));
      platform.heap.restore(snapshot);
      assert.deepEqual(content(platform, reference), units('abcdefghi'));
      remove(platform, reference, 0, 9);
      platform.invoke(builderContract('Append', ['string']), [reference, platform.heap.string('next')]);
      assert.deepEqual(content(platform, reference), units('next'));
    });
  });
  test(`StringBuilder.Remove ${engine}: a throwing length observer retains the existing committed-write policy and releases roots`, () => {
    withBuilder(engine, ['abc', 'def'].map(units), ({platform, vm, reference}) => {
      const pins = platform.heap.pins.length;
      vm.onWrite = event => {
        if (event.property === '$length') {
          platform.heap.collect();
          throw new Error('observer stopped');
        }
      };
      try {assert.throws(() => remove(platform, reference, 1, 3), /observer stopped/);}
      finally {vm.onWrite = null;}
      assert.equal(platform.heap.pins.length, pins);
      assert.equal(platform.get(reference, '$length'), 3);
      assert.deepEqual(content(platform, reference), units('aef'));
    });
  });
  test(`StringBuilder.Remove ${engine}: bounded ten-thousand-step UTF-16 edit trace`, () => {
    withBuilder(engine, ['a\0\ud800', '\udc00xyz'].map(units), ({platform, reference}) => {
      let expected = 'a\0\ud800\udc00xyz';
      let seed = 0x2638;
      const random = maximum => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed >>> 8) % maximum;
      };
      for (let step = 0; step < 10000; step++) {
        if (step % 3 === 0 && expected.length < 96) {
          const value = 'a\0\ud800b\udc00';
          platform.invoke(builderContract('Append', ['string']), [reference, platform.heap.string(value)]);
          expected += value;
        } else {
          const start = random(expected.length + 1), length = random(expected.length - start + 1);
          assert.deepEqual(remove(platform, reference, start, length), reference);
          expected = expected.slice(0, start) + expected.slice(start + length);
        }
        assert.deepEqual(content(platform, reference), units(expected), 'step ' + step);
        if (step % 128 === 0) platform.heap.collect();
      }
    });
  });
}

test('StringBuilder.Remove: independent CIL matches every native result and fault', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderRemoveAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) fault(result.fault, row);
      else assert.equal(Boolean(vm.statics.get(0x04000002)), true, row.id);
      assert.deepEqual(content(vm.platform, vm.statics.get(0x04000001)), row.after?.text ?? null, row.id);
    } finally {vm.stop();}
  }
});

test('StringBuilder.Remove: pinned provenance and released contract 815 remain unchanged', () => {
  const source = readFileSync(new URL('string-builder-remove/Program.cs', directory));
  assert.equal(native.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(native.sourceSha256, 'be4303dc07d122812afad033cea599b1cce7b63593a297d26397f9963ae9a1f3');
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.rows.length, 150);
  assert.equal(builderContract('Remove', ['int', 'int']).id, 815);
  for (const row of native.rows) {
    if (!row.before) continue;
    assert.equal(row.after.maxCapacity, row.before.maxCapacity, row.id);
    if (row.fault || row.length === 0) assert.deepEqual(row.after, row.before, row.id);
  }
  const capacityControl = native.rows.find(row => row.id === 'flat-prefix');
  assert.equal(capacityControl.before.capacity, 5);
  assert.equal(capacityControl.after.capacity, 4, 'native nonempty capacity changes are retained, not claimed as runtime parity');
});
