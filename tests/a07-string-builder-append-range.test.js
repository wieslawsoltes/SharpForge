import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {MAX} from '@sharpforge/bcl-core';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderPlatform, builderContract, units} from './fixtures/string-builder/append-char.js';
import {builderRangeAssembly, rangeParameters, rangeText} from './fixtures/string-builder/append-range.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-append-range-net10.json', directory), 'utf8'));

function assertFault(error, row) {
  assert.equal(error.name, row.fault, row.id);
  if (row.parameter) assert(error.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + error.message);
  return true;
}

test('StringBuilder range append: source platform matches native UTF-16 content, identity and validation precedence', () => {
  for (const row of native.rows) {
    const builder = builderPlatform('source', native.initial);
    const {platform, reference, call} = builder;
    const value = row.value === null ? null : platform.heap.string(rangeText(row));
    try {
      const invoke = () => platform.invoke(builderContract('Append', rangeParameters),
        [row.nullReceiver ? null : reference, value, row.startIndex, row.count]);
      if (row.fault) assert.throws(invoke, error => assertFault(error, row));
      else assert.deepEqual(invoke(), reference, row.id);
      if (!row.nullReceiver) {
        assert.deepEqual(units(platform.native(call('ToString'))), row.output, row.id);
        assert.equal(call('get_Length'), row.length, row.id);
      }
    } finally { builder.stop(); }
  }
});

test('StringBuilder range append: independent CIL preserves native content and faults for the exact overload', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderRangeAssembly(row, native.initial));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) assertFault(result.fault, row);
      else assert.equal(Boolean(vm.statics.get(0x04000002)), row.same, row.id);
      if (!row.nullReceiver) {
        const reference = vm.statics.get(0x04000001);
        const output = vm.platform.native(vm.platform.invoke(builderContract('ToString'), [reference]));
        assert.deepEqual(units(output), row.output, row.id);
      }
    } finally { vm.stop(); }
  }
});

for (const engine of ['source', 'cil']) {
  test(`StringBuilder range append ${engine}: native zero-count successes need no writes or managed allocation budget`, () => {
    for (const row of native.rows.filter(item => !item.fault && item.count === 0)) {
      const builder = builderPlatform(engine, native.initial);
      const {platform, vm, reference, call} = builder;
      const {heap} = platform;
      const value = row.value === null ? null : heap.string(rangeText(row));
      const state = [heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision,
        platform.get(reference, '$version'), platform.get(reference, '$data')];
      const budget = heap.maxBytes;
      let writes = 0;
      try {
        heap.maxBytes = 1;
        vm.onWrite = () => { writes++; };
        assert.deepEqual(call('Append', rangeParameters, [value, row.startIndex, row.count]), reference, row.id);
        assert.equal(writes, 0, row.id);
        assert.deepEqual([heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision,
          platform.get(reference, '$version'), platform.get(reference, '$data')], state, row.id);
      } finally { vm.onWrite = null; heap.maxBytes = budget; builder.stop(); }
    }
  });

  test(`StringBuilder range append ${engine}: one selected chunk and original input remain rooted during observer GC`, () => {
    const builder = builderPlatform(engine);
    const {platform, vm, reference, call} = builder;
    const {heap} = platform;
    const selected = '\0\ud800'.repeat(2049);
    const value = heap.string('prefix' + selected + 'suffix');
    const storage = platform.get(reference, '$data');
    const allocations = heap.stats.allocations;
    const version = platform.get(reference, '$version');
    let writes = 0;
    try {
      vm.onWrite = event => {
        if (event.kind === 'array') writes++;
        heap.collect();
        assert.equal(platform.native(value), 'prefix' + selected + 'suffix');
      };
      assert.deepEqual(call('Append', rangeParameters, [value, 6, selected.length]), reference);
      assert.equal(writes, 1);
      assert.equal(heap.stats.allocations - allocations, 1);
      assert.deepEqual(platform.get(reference, '$data'), storage);
      assert.equal(platform.get(reference, '$version'), version + 1);
      assert.equal(heap.pins.length, 0);
      vm.onWrite = null;
      const snapshot = heap.snapshot();
      call('Clear');
      heap.restore(snapshot);
      assert.equal(platform.native(call('ToString')), 'seed|' + selected);
    } finally { vm.onWrite = null; builder.stop(); }
  });

  test(`StringBuilder range append ${engine}: argument faults precede host limits and failed allocation retains the prefix`, () => {
    const builder = builderPlatform(engine);
    const {platform, reference, call} = builder;
    const {heap} = platform;
    const value = heap.string('abc');
    const budget = heap.maxBytes;
    try {
      heap.maxBytes = 1;
      assert.throws(() => call('Append', rangeParameters, [value, 1, 1]), {name: 'OutOfMemoryException'});
      heap.maxBytes = budget;
      assert.equal(platform.native(call('ToString')), 'seed|');
      heap.withRoots([value], () => call('set_Length', ['int'], [MAX - 1]));
      const version = platform.get(reference, '$version');
      assert.throws(() => call('Append', rangeParameters, [null, 1, 1]), {name: 'ArgumentNullException'});
      assert.throws(() => call('Append', rangeParameters, [value, 3, 2]), {name: 'ArgumentOutOfRangeException'});
      assert.throws(() => call('Append', rangeParameters, [value, 0, 2]), {name: 'OutOfMemoryException'});
      assert.equal(platform.get(reference, '$version'), version);
      assert.equal(call('get_Length'), MAX - 1);
      call('Append', rangeParameters, [value, 2, 1]);
      assert.equal(call('get_Length'), MAX);
      assert.equal(heap.pins.length, 0);
    } finally { heap.maxBytes = budget; builder.stop(); }
  });

  test(`StringBuilder range append ${engine}: only the selected text is subject to the host output limit`, () => {
    const builder = builderPlatform(engine);
    const {platform, reference, call} = builder;
    const value = platform.heap.string('x'.repeat(MAX) + 'Z', [reference]);
    try {
      call('Append', rangeParameters, [value, MAX, 1]);
      assert.equal(platform.native(call('ToString')), 'seed|Z');
    } finally { builder.stop(); }
  });

  test(`StringBuilder range append ${engine}: throwing observers preserve existing partial chunk progress and release roots`, () => {
    const builder = builderPlatform(engine);
    const {platform, vm, reference, call} = builder;
    const value = platform.heap.string('prefix-selected-suffix');
    const storage = platform.heap.get(platform.get(reference, '$data')).data;
    const failure = new Error('Range append observer failed');
    try {
      vm.onWrite = event => { platform.heap.collect(); if (event.kind === 'array') throw failure; };
      assert.throws(() => call('Append', rangeParameters, [value, 7, 8]), error => error === failure);
      vm.onWrite = null;
      assert.equal(platform.native(storage[1]), 'selected');
      assert.equal(platform.get(reference, '$count'), 1);
      assert.equal(platform.heap.pins.length, 0);
      assert.equal(platform.native(call('ToString')), 'seed|');
      call('Append', ['char'], [66]);
      assert.equal(platform.native(call('ToString')), 'seed|B');
    } finally { vm.onWrite = null; builder.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringBuilder range append ${pipeline}/${engine}: compiled calls evaluate inputs once and preserve UTF-16 units`, () => {
      const program = compileToIL(`using System; using System.Text;
        class Program {
          static int calls;
          static StringBuilder Receiver(StringBuilder value) { calls = calls * 10 + 1; return value; }
          static string Value() { calls = calls * 10 + 2; return "x\\0\\uD800\\uDC00\\uD800\\uDC00z"; }
          static int Start() { calls = calls * 10 + 3; return 1; }
          static int Count() { calls = calls * 10 + 4; return 4; }
          static void Main() {
            var builder = new StringBuilder("seed|");
            var returned = Receiver(builder).Append(Value(), Start(), Count());
            Console.WriteLine(calls); Console.WriteLine(object.ReferenceEquals(builder, returned));
            string output = builder.ToString();
            for (int index = 0; index < output.Length; index++) Console.WriteLine((int)output[index]);
            string missingValue = null;
            builder.Append("", int.MaxValue, 0); builder.Append(missingValue, 0, 0); Console.WriteLine(builder.Length);
            try { builder.Append(missingValue, -1, -1); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            try { builder.Append(missingValue, 0, 1); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            StringBuilder missing = null;
            try { missing.Append(missingValue, -1, -1); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
          }
        }`, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '1234\nTrue\n115\n101\n101\n100\n124\n0\n55296\n56320\n55296\n9\n' +
          'ArgumentOutOfRangeException\nArgumentNullException\nNullReferenceException\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringBuilder range append adds one tail contract and retains unchanged native provenance', () => {
  assert.equal(builderContract('Append', rangeParameters).id, 524319);
  assert.equal(builderContract('Append', ['long']).id, 524316);
  assert.equal(builderContract('Append', ['ulong']).id, 524317);
  const search = findContracts('System.String', 'LastIndexOf')
    .find(row => row.parameters.join(',') === 'string,int,int,System.StringComparison');
  assert.equal(search.id, 524318);
  assert.equal(native.rows.length, 52);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  const source = readFileSync(new URL('string-builder-append-range/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
