import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderContract, units} from './fixtures/string-builder/append-char.js';
import {segmentedBuilder} from './fixtures/string-builder/indexer.js';
import {copyParameters, copyBuilderTo, builderCopyAssembly} from './fixtures/string-builder/copy-to.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-copy-to-net10.json', directory), 'utf8'));
const initial = 'ab\0\ud800cd\udc00';
const range = (sourceIndex, destinationIndex, count) => ({sourceIndex, destinationIndex, count});

function destinationFor(builder, length = 9) {
  const {platform, reference} = builder;
  return length === null ? null : platform.heap.withRoots([reference], () =>
    platform.heap.allocate('array', 'char[]', Array(length).fill(46)));
}

function assertFault(error, row) {
  assert.equal(error.name, row.fault, row.id);
  if (row.parameter) assert(error.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + error.message);
  else if (row.fault === 'ArgumentOutOfRangeException') assert.doesNotMatch(error.message, /\(Parameter '/, row.id);
  return true;
}

test('StringBuilder CopyTo: source platform preserves every native buffer outcome and argument precedence', () => {
  for (const row of native.rows) {
    const builder = segmentedBuilder('source', row.segments.map(segment => String.fromCharCode(...segment)));
    const {platform, reference, call} = builder;
    const destination = destinationFor(builder, row.destinationLength);
    try {
      const invoke = () => copyBuilderTo(platform, row.nullReceiver ? null : reference, destination, row);
      if (row.fault) assert.throws(invoke, error => assertFault(error, row));
      else assert.equal(invoke(), null, row.id);
      assert.deepEqual(destination === null ? null : platform.heap.get(destination).data, row.output, row.id);
      if (!row.nullReceiver) {
        assert.deepEqual(units(platform.native(call('ToString'))), row.builder, row.id);
        assert.equal(call('get_Length'), row.length, row.id);
        assert.equal(call('get_Capacity'), row.capacity, row.id);
      }
    } finally { builder.stop(); }
  }
});

test('StringBuilder CopyTo: independent CIL calls the native array signature and retains buffers after faults', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderCopyAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) assertFault(result.fault, row);
      const destination = vm.statics.get(0x04000002);
      assert.deepEqual(destination === null ? null : vm.platform.heap.get(destination).data, row.output, row.id);
    } finally { vm.stop(); }
  }
});

for (const engine of ['source', 'cil']) {
  test(`StringBuilder CopyTo ${engine}: validated count zero makes no writes or managed allocations`, () => {
    const builder = segmentedBuilder(engine);
    const {platform, vm, reference} = builder;
    const {heap} = platform;
    const destination = destinationFor(builder);
    const before = [heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision, platform.get(reference, '$version')];
    const budget = heap.maxBytes;
    let writes = 0;
    try {
      vm.onWrite = () => { writes++; };
      heap.maxBytes = 1;
      assert.equal(copyBuilderTo(platform, reference, destination, range(7, 9, 0)), null);
      assert.equal(writes, 0);
      assert.deepEqual([heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision,
        platform.get(reference, '$version')], before);
      assert.deepEqual(heap.get(destination).data, Array(9).fill(46));
    } finally { vm.onWrite = null; heap.maxBytes = budget; builder.stop(); }
  });

  test(`StringBuilder CopyTo ${engine}: copied units notify once, allocate no managed text and survive snapshot restoration`, () => {
    const builder = segmentedBuilder(engine);
    const {platform, vm, reference, call} = builder;
    const {heap} = platform;
    const destination = destinationFor(builder);
    const allocations = heap.stats.allocations;
    const builderVersion = platform.get(reference, '$version');
    const snapshot = heap.snapshot();
    const seen = [];
    try {
      vm.onWrite = event => {
        assert.equal(event.kind, 'array');
        assert.equal(event.handle, destination.h);
        assert.equal(event.oldValue, 46);
        seen.push([event.index, event.value]);
        heap.collect();
      };
      assert.equal(copyBuilderTo(platform, reference, destination, range(1, 2, 5)), null);
      assert.equal(heap.stats.allocations, allocations);
      assert.deepEqual(seen, units(initial.slice(1, 6)).map((unit, index) => [index + 2, unit]));
      assert.equal(platform.get(reference, '$version'), builderVersion);
      assert.equal(heap.pins.length, 0);
      vm.onWrite = null;
      assert.equal(platform.native(call('ToString')), initial);
      heap.restore(snapshot);
      assert.deepEqual(heap.get(destination).data, Array(9).fill(46));
      assert.equal(platform.native(call('ToString')), initial);
    } finally { vm.onWrite = null; builder.stop(); }
  });

  test(`StringBuilder CopyTo ${engine}: original live chunk snapshot survives observer source mutation and collection`, () => {
    for (const mutation of ['Clear', 'set_Chars', 'Append']) {
      const builder = segmentedBuilder(engine);
      const {platform, vm, reference, call} = builder;
      const destination = destinationFor(builder);
      let armed = true;
      try {
        vm.onWrite = event => {
          if (armed && event.handle === destination.h) {
            armed = false;
            if (mutation === 'Clear') call('Clear');
            else if (mutation === 'set_Chars') call('set_Chars', ['int', 'char'], [3, 90]);
            else call('Append', ['char'], [33]);
          }
          platform.heap.collect();
        };
        copyBuilderTo(platform, reference, destination, range(0, 1, 7));
        vm.onWrite = null;
        assert.equal(armed, false);
        assert.deepEqual(platform.heap.get(destination).data, [46, ...units(initial), 46]);
        const expected = mutation === 'Clear' ? '' : mutation === 'set_Chars' ? 'ab\0Zcd\udc00' : initial + '!';
        assert.equal(platform.native(call('ToString')), expected);
        assert.equal(platform.heap.pins.length, 0);
      } finally { vm.onWrite = null; builder.stop(); }
    }
  });

  test(`StringBuilder CopyTo ${engine}: throwing observers retain the completed destination prefix without leaking roots`, () => {
    for (const stop of [1, 4, 7]) {
      const builder = segmentedBuilder(engine);
      const {platform, vm, reference, call} = builder;
      const destination = destinationFor(builder);
      const revision = platform.heap.mutationRevision;
      const failure = new Error('Copy observer failed');
      let writes = 0;
      try {
        vm.onWrite = event => {
          assert.equal(event.handle, destination.h);
          platform.heap.collect();
          if (++writes === stop) throw failure;
        };
        assert.throws(() => copyBuilderTo(platform, reference, destination, range(0, 1, 7)), error => error === failure);
        vm.onWrite = null;
        assert.deepEqual(platform.heap.get(destination).data, [46, ...units(initial.slice(0, stop)), ...Array(8 - stop).fill(46)]);
        assert(platform.heap.mutationRevision > revision);
        assert.equal(platform.native(call('ToString')), initial);
        assert.equal(platform.heap.pins.length, 0);
      } finally { vm.onWrite = null; builder.stop(); }
    }
  });

  test(`StringBuilder CopyTo ${engine}: a successful copy needs no managed allocation budget and ignores spare chunk slots`, () => {
    const builder = segmentedBuilder(engine, ['ab', '\0', '\ud800']);
    const {platform, reference} = builder;
    const {heap} = platform;
    const destination = destinationFor(builder);
    const budget = heap.maxBytes;
    const allocations = heap.stats.allocations;
    const revision = heap.mutationRevision;
    try {
      heap.maxBytes = 1;
      copyBuilderTo(platform, reference, destination, range(0, 2, 4));
      assert.deepEqual(heap.get(destination).data, [46, 46, 97, 98, 0, 0xd800, 46, 46, 46]);
      assert.equal(heap.stats.allocations, allocations);
      assert.equal(heap.mutationRevision - revision, 4);
      assert.equal(heap.pins.length, 0);
    } finally { heap.maxBytes = budget; builder.stop(); }
  });

  test(`StringBuilder CopyTo ${engine}: chunk contents are visited once and units after the copy window are not flattened`, () => {
    const builder = segmentedBuilder(engine, Array.from({length: 32}, (_, index) => String.fromCharCode(65 + index).repeat(8)));
    const {platform, reference} = builder;
    const destination = destinationFor(builder, 130);
    const storage = platform.heap.get(platform.get(reference, '$data')).data;
    const records = storage.slice(0, 32).map(value => platform.heap.get(value));
    const values = records.map(record => record.data);
    const reads = new Uint32Array(records.length);
    try {
      records.forEach((record, index) => Object.defineProperty(record, 'data', {
        configurable: true, get() { reads[index]++; return values[index]; }
      }));
      copyBuilderTo(platform, reference, destination, range(3, 1, 128));
      assert.deepEqual([...reads], [...Array(17).fill(1), ...Array(15).fill(0)]);
      assert.deepEqual(platform.heap.get(destination).data, [46, ...units(values.join('').slice(3, 131)), 46]);
    } finally {
      records.forEach((record, index) => Object.defineProperty(record, 'data', {
        configurable: true, writable: true, enumerable: true, value: values[index]
      }));
      builder.stop();
    }
  });

  test(`StringBuilder CopyTo ${engine}: malformed host array/scalar inputs fail before writing`, () => {
    const builder = segmentedBuilder(engine);
    const {platform, reference} = builder;
    const destination = destinationFor(builder);
    try {
      for (const type of ['int[]', 'char[,]', 'char[*]']) {
        const wrongType = platform.heap.allocate('array', type, [46]);
        assert.throws(() => copyBuilderTo(platform, reference, wrongType, range(0, 0, 1)), {name: 'ArgumentException'});
      }
      for (const [values, parameter] of [[range(NaN, 0, 0), 'sourceIndex'],
        [range(0, 1.5, 0), 'destinationIndex'], [range(0, 0, Infinity), 'count']]) {
        assert.throws(() => copyBuilderTo(platform, reference, destination, values), error => {
          assert.equal(error.name, 'ArgumentOutOfRangeException');
          assert(error.message.includes("Parameter '" + parameter + "'"));
          return true;
        });
      }
      assert.deepEqual(platform.heap.get(destination).data, Array(9).fill(46));
    } finally { builder.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringBuilder CopyTo ${pipeline}/${engine}: real array calls evaluate arguments once in source order`, () => {
      const program = compileToIL(`using System; using System.Text;
        class Program {
          static int calls;
          static StringBuilder Receiver(StringBuilder value) { calls = calls * 10 + 1; return value; }
          static int Source() { calls = calls * 10 + 2; return 1; }
          static char[] Target(char[] value) { calls = calls * 10 + 3; return value; }
          static int Destination() { calls = calls * 10 + 4; return 2; }
          static int Count() { calls = calls * 10 + 5; return 5; }
          static void Main() {
            var builder = new StringBuilder("ab"); builder.Append('\\u0000').Append('\\uD800').Append("cd\\uDC00");
            char[] buffer = new char[9];
            Receiver(builder).CopyTo(Source(), Target(buffer), Destination(), Count()); Console.WriteLine(calls);
            for (int index = 0; index < buffer.Length; index++) Console.WriteLine((int)buffer[index]);
            Console.WriteLine(builder.Length);
            char[] missing = null;
            try { builder.CopyTo(0, missing, 0, 0); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            StringBuilder absent = null;
            try { absent.CopyTo(-1, missing, -1, -1); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
          }
        }`, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '12345\n0\n0\n98\n0\n55296\n99\n100\n0\n0\n7\nArgumentNullException\nNullReferenceException\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringBuilder CopyTo adds one tail contract and preserves exact native capture provenance', () => {
  assert.equal(builderContract('CopyTo', copyParameters).id, 524315);
  assert.equal(builderContract('get_Chars', ['int']).id, 524312);
  assert.equal(builderContract('set_Chars', ['int', 'char']).id, 524313);
  const search = findContracts('System.String', 'LastIndexOf')
    .find(row => row.parameters.join(',') === 'string,int,System.StringComparison');
  assert.equal(search.id, 524314);
  assert.equal(native.rows.length, 50);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  const source = readFileSync(new URL('string-builder-copy-to/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
