import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {MAX} from '@sharpforge/bcl-core';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderPlatform, builderContract, units} from './fixtures/string-builder/append-char.js';
import {arrayParameters, arrayArguments, managedCharacters, builderArrayAssembly} from './fixtures/string-builder/append-array.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-append-array-net10.json', directory), 'utf8'));

function assertFault(error, row) {
  assert.equal(error.name, row.fault, row.id);
  if (row.parameter) assert(error.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + error.message);
  else assert.equal(error.message.includes("(Parameter '"), false, row.id);
  return true;
}

test('StringBuilder array append: source platform matches all native content, identity and validation rows', () => {
  for (const row of native.rows) {
    const builder = builderPlatform('source', String.fromCharCode(...row.initial));
    const {platform, reference, call} = builder;
    const value = managedCharacters(platform, row.value);
    try {
      const invoke = () => platform.invoke(builderContract('Append', arrayParameters(row)),
        [row.nullReceiver ? null : reference, ...arrayArguments(row, value)]);
      if (row.fault) assert.throws(invoke, error => assertFault(error, row));
      else assert.deepEqual(invoke(), reference, row.id);
      if (!row.nullReceiver) {
        assert.deepEqual(units(platform.native(call('ToString'))), row.output, row.id);
        assert.equal(call('get_Length'), row.length, row.id);
      }
      if (value) assert.deepEqual(platform.heap.get(value).data, row.value, row.id);
    } finally { builder.stop(); }
  }
});

test('StringBuilder array append: independent CIL executes both native signatures for all oracle rows', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderArrayAssembly(row));
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
      const value = vm.statics.get(0x04000003);
      if (value) assert.deepEqual(vm.heap.get(value).data, row.value, row.id);
    } finally { vm.stop(); }
  }
});

for (const engine of ['source', 'cil']) {
  test(`StringBuilder array append ${engine}: native null and zero-count no-ops need no writes or allocation budget`, () => {
    const rows = native.rows.filter(row => !row.fault && row.output.length === row.initial.length);
    for (const row of rows) {
      const builder = builderPlatform(engine, String.fromCharCode(...row.initial));
      const {platform, vm, reference, call} = builder;
      const {heap} = platform;
      const value = managedCharacters(platform, row.value);
      const state = [heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision,
        platform.get(reference, '$version'), platform.get(reference, '$data')];
      const budget = heap.maxBytes;
      let writes = 0;
      try {
        heap.maxBytes = 1;
        vm.onWrite = () => { writes++; };
        assert.deepEqual(call('Append', arrayParameters(row), arrayArguments(row, value)), reference, row.id);
        assert.equal(writes, 0, row.id);
        assert.deepEqual([heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision,
          platform.get(reference, '$version'), platform.get(reference, '$data')], state, row.id);
      } finally { vm.onWrite = null; heap.maxBytes = budget; builder.stop(); }
    }
  });

  test(`StringBuilder array append ${engine}: block boundaries preserve all UTF-16 units in one managed chunk`, () => {
    const builder = builderPlatform(engine);
    const {platform, vm, reference, call} = builder;
    const {heap} = platform;
    const selected = Array.from({length: 8195}, (_, index) => [0, 0xd800, 0xdc00, 65, 0xd800, 66, 0xdc00][index % 7]);
    const input = [88, ...selected, 89];
    const value = heap.withRoots([reference], () => managedCharacters(platform, input));
    const storage = platform.get(reference, '$data');
    const allocations = heap.stats.allocations;
    const version = platform.get(reference, '$version');
    let writes = 0;
    try {
      vm.onWrite = event => {
        if (event.kind === 'array') writes++;
        heap.collect();
        assert.deepEqual(heap.get(value).data, input);
      };
      assert.deepEqual(call('Append', ['char[]', 'int', 'int'], [value, 1, selected.length]), reference);
      assert.equal(writes, 1);
      assert.equal(heap.stats.allocations - allocations, 1);
      assert.deepEqual(platform.get(reference, '$data'), storage);
      assert.equal(platform.get(reference, '$version'), version + 1);
      assert.equal(heap.pins.length, 0);
      vm.onWrite = null;
      const snapshot = heap.snapshot();
      call('Clear');
      heap.restore(snapshot);
      assert.deepEqual(units(platform.native(call('ToString'))), [...units('seed|'), ...selected]);
    } finally { vm.onWrite = null; builder.stop(); }
  });

  test(`StringBuilder array append ${engine}: exact character-array and scalar guards reject malformed host inputs`, () => {
    const builder = builderPlatform(engine);
    const {platform, call} = builder;
    const {heap} = platform;
    try {
      const wrong = [42, heap.string('A'), heap.allocate('array', 'int[]', [65]),
        heap.allocate('array', 'char[,]', [65]), heap.allocate('array', 'char[*]', [65]), heap.allocate('object', 'char[]', [65])];
      for (const value of wrong) {
        assert.throws(() => call('Append', ['char[]'], [value]), {name: 'ArgumentException'});
        assert.throws(() => call('Append', ['char[]', 'int', 'int'], [value, 0, 0]), {name: 'ArgumentException'});
      }
      const value = managedCharacters(platform, [65]);
      for (const invalid of [NaN, Infinity, 1.5, 2147483648]) {
        assert.throws(() => call('Append', ['char[]', 'int', 'int'], [value, invalid, 0]), {name: 'ArgumentOutOfRangeException'});
        assert.throws(() => call('Append', ['char[]', 'int', 'int'], [value, 0, invalid]), {name: 'ArgumentOutOfRangeException'});
      }
      for (const invalid of [-1, 65536, NaN, 1.5]) {
        heap.get(value).data[0] = invalid;
        assert.throws(() => call('Append', ['char[]'], [value]), {name: 'ArgumentOutOfRangeException'});
        assert.deepEqual(call('Append', ['char[]', 'int', 'int'], [value, 0, 0]), builder.reference);
      }
      assert.equal(platform.native(call('ToString')), 'seed|');
    } finally { builder.stop(); }
  });

  test(`StringBuilder array append ${engine}: bounds and host limits precede conversion and allocation failure retains text`, () => {
    const builder = builderPlatform(engine);
    const {platform, reference, call} = builder;
    const {heap} = platform;
    const value = managedCharacters(platform, [65, 66]);
    const budget = heap.maxBytes;
    try {
      heap.withRoots([value], () => {
        heap.maxBytes = 1;
        assert.throws(() => call('Append', ['char[]'], [value]), {name: 'OutOfMemoryException'});
        heap.maxBytes = budget;
        assert.equal(platform.native(call('ToString')), 'seed|');
        call('set_Length', ['int'], [MAX - 1]);
        const data = heap.get(value).data;
        Object.defineProperty(data, 0, {configurable: true, get() { throw new Error('Unexpected conversion before validation'); }});
        const version = platform.get(reference, '$version');
        try {
          assert.throws(() => call('Append', ['char[]', 'int', 'int'], [value, 3, 0]), {name: 'ArgumentOutOfRangeException'});
          assert.throws(() => call('Append', ['char[]'], [value]), {name: 'OutOfMemoryException'});
          assert.deepEqual(call('Append', ['char[]', 'int', 'int'], [value, 0, 0]), reference);
          assert.equal(platform.get(reference, '$version'), version);
        } finally { Object.defineProperty(data, 0, {configurable: true, writable: true, enumerable: true, value: 65}); }
        call('Append', ['char[]', 'int', 'int'], [value, 1, 1]);
        assert.equal(call('get_Length'), MAX);
      });
      assert.equal(heap.pins.length, 0);
    } finally { heap.maxBytes = budget; builder.stop(); }
  });

  test(`StringBuilder array append ${engine}: conversion reads only the requested slice`, () => {
    const builder = builderPlatform(engine);
    const {platform, call} = builder;
    const value = managedCharacters(platform, [88, 65, 0xd800, 89]);
    const data = platform.heap.get(value).data;
    const fail = () => { throw new Error('Read outside selected array range'); };
    try {
      Object.defineProperty(data, 0, {configurable: true, get: fail});
      Object.defineProperty(data, 3, {configurable: true, get: fail});
      call('Append', ['char[]', 'int', 'int'], [value, 1, 2]);
      assert.equal(platform.native(call('ToString')), 'seed|A\ud800');
    } finally {
      Object.defineProperty(data, 0, {configurable: true, writable: true, enumerable: true, value: 88});
      Object.defineProperty(data, 3, {configurable: true, writable: true, enumerable: true, value: 89});
      builder.stop();
    }
  });

  test(`StringBuilder array append ${engine}: throwing observers preserve released partial progress and release roots`, () => {
    const builder = builderPlatform(engine);
    const {platform, vm, reference, call} = builder;
    const value = managedCharacters(platform, [65, 0xd800]);
    const storage = platform.heap.get(platform.get(reference, '$data')).data;
    const failure = new Error('Array append observer failed');
    try {
      vm.onWrite = event => { platform.heap.collect(); if (event.kind === 'array') throw failure; };
      assert.throws(() => call('Append', ['char[]'], [value]), error => error === failure);
      vm.onWrite = null;
      assert.equal(platform.native(storage[1]), 'A\ud800');
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
    test(`StringBuilder array append ${pipeline}/${engine}: compiled typed arrays select both overloads and evaluate once`, () => {
      const program = compileToIL(`using System; using System.Text;
        class Program {
          static int calls;
          static StringBuilder Receiver(StringBuilder value) { calls = calls * 10 + 1; return value; }
          static char[] Value() { calls = calls * 10 + 2; return new char[] { 'x', '\\0', '\\uD800', '\\uDC00', '\\uD800', 'z' }; }
          static int Start() { calls = calls * 10 + 3; return 1; }
          static int Count() { calls = calls * 10 + 4; return 4; }
          static void Main() {
            var builder = new StringBuilder("seed|");
            var returned = Receiver(builder).Append(Value(), Start(), Count());
            Console.WriteLine(calls); Console.WriteLine(object.ReferenceEquals(builder, returned));
            char[] tail = new char[] { '\\uDC00', '!' }; builder.Append(tail);
            string output = builder.ToString();
            for (int index = 0; index < output.Length; index++) Console.WriteLine((int)output[index]);
            char[] missingValue = null; builder.Append(missingValue); builder.Append(missingValue, 0, 0);
            builder.Append(tail, tail.Length, 0); Console.WriteLine(builder.Length);
            try { builder.Append(missingValue, -1, -1); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            try { builder.Append(missingValue, 0, 1); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            try { builder.Append(tail, int.MaxValue, 0); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            StringBuilder missing = null;
            try { missing.Append(missingValue); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
          }
        }`, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '1234\nTrue\n115\n101\n101\n100\n124\n0\n55296\n56320\n55296\n56320\n33\n11\n' +
          'ArgumentOutOfRangeException\nArgumentNullException\nArgumentOutOfRangeException\nNullReferenceException\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringBuilder array append preserves preceding IDs and unchanged native provenance', () => {
  assert.equal(builderContract('Append', ['char[]']).id, 524320);
  assert.equal(builderContract('Append', ['char[]', 'int', 'int']).id, 524321);
  assert.equal(builderContract('Append', ['string', 'int', 'int']).id, 524319);
  assert.equal(builderContract('Append', ['ulong']).id, 524317);
  assert.equal(builderContract('Append', ['char']).id, 524309);
  assert.equal(native.rows.length, 61);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  const source = readFileSync(new URL('string-builder-append-array/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
