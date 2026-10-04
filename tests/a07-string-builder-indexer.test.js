import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts, frameworkType} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderContract, units} from './fixtures/string-builder/append-char.js';
import {segmentedBuilder, builderIndexerAssembly, invokeIndexer} from './fixtures/string-builder/indexer.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-indexer-net10.json', directory), 'utf8'));

function assertFault(error, row) {
  assert.equal(error.name, row.fault, row.id);
  if (row.parameter) assert(error.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + error.message);
  return true;
}

test('StringBuilder indexer: source platform matches all native getter/setter bounds and UTF-16 units', () => {
  for (const row of native.rows) {
    const segments = row.segments?.map(segment => String.fromCharCode(...segment)) ?? [];
    const builder = segmentedBuilder('source', segments);
    const {platform, reference, call} = builder;
    try {
      const invoke = () => invokeIndexer(platform, row.segments === null ? null : reference, row);
      if (row.fault) assert.throws(invoke, error => assertFault(error, row));
      else assert.equal(invoke(), row.result, row.id);
      if (row.segments !== null) {
        assert.deepEqual(units(platform.native(call('ToString'))), row.output, row.id);
        assert.equal(call('get_Length'), row.length, row.id);
        assert.equal(call('get_Capacity'), row.capacity, row.id);
        assert.equal(call('get_MaxCapacity'), row.maxCapacity, row.id);
      }
    } finally { builder.stop(); }
  }
});

test('StringBuilder indexer: independently assembled CIL retains native accessor names and fault precedence', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderIndexerAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) assertFault(result.fault, row);
      else if (!row.write) assert.equal(result.returnValue, row.result, row.id);
      const reference = vm.statics.get(0x04000001);
      const output = reference === null ? null : units(vm.platform.native(vm.platform.invoke(builderContract('ToString'), [reference])));
      assert.deepEqual(output, row.output, row.id);
    } finally { vm.stop(); }
  }
});

for (const engine of ['source', 'cil']) {
  test(`StringBuilder indexer ${engine}: getter spans chunks without allocation or mutation`, () => {
    const builder = segmentedBuilder(engine);
    const {platform, reference, call} = builder;
    const {heap} = platform;
    const expected = units('ab\0\ud800cd\udc00');
    const allocations = heap.stats.allocations;
    try {
      heap.withRoots([reference], () => heap.collect());
      const revision = heap.mutationRevision;
      for (let index = 0; index < expected.length; index++) assert.equal(call('get_Chars', ['int'], [index]), expected[index]);
      assert.equal(heap.stats.allocations, allocations);
      assert.equal(heap.mutationRevision, revision);
    } finally { builder.stop(); }
  });

  test(`StringBuilder indexer ${engine}: setter replaces one chunk, roots displaced text and preserves structural state`, () => {
    const builder = segmentedBuilder(engine);
    const {platform, vm, reference, call} = builder;
    const {heap} = platform;
    const storage = platform.get(reference, '$data');
    const previous = [...heap.get(storage).data];
    const state = [platform.get(reference, '$count'), call('get_Length'), call('get_Capacity')];
    const version = platform.get(reference, '$version');
    const allocations = heap.stats.allocations;
    const revision = heap.mutationRevision;
    let writes = 0;
    try {
      vm.onWrite = event => {
        heap.collect();
        if (event.kind === 'array') {
          writes++;
          assert.equal(event.index, 3);
          assert.equal(platform.native(event.oldValue), 'cd\udc00');
          assert.equal(platform.native(event.value), 'c\ud800\udc00');
        }
      };
      assert.equal(call('set_Chars', ['int', 'char'], [5, 0xd800]), null);
      assert.equal(writes, 1);
      assert.equal(heap.stats.allocations - allocations, 1);
      assert(heap.mutationRevision > revision);
      assert.deepEqual(platform.get(reference, '$data'), storage);
      assert.deepEqual([platform.get(reference, '$count'), call('get_Length'), call('get_Capacity')], state);
      assert.equal(platform.get(reference, '$version'), version + 1);
      for (const index of [0, 1, 2]) assert.deepEqual(heap.get(storage).data[index], previous[index]);
      assert.notDeepEqual(heap.get(storage).data[3], previous[3]);
      assert.equal(heap.pins.length, 0);
      vm.onWrite = null;
      assert.equal(platform.native(call('ToString')), 'ab\0\ud800c\ud800\udc00');
      const snapshot = heap.snapshot();
      call('set_Chars', ['int', 'char'], [2, 65]);
      heap.restore(snapshot);
      assert.equal(call('get_Chars', ['int'], [2]), 0);
    } finally { vm.onWrite = null; builder.stop(); }
  });

  test(`StringBuilder indexer ${engine}: reentrant Clear keeps its text and never resurrects a stale chunk`, () => {
    const builder = segmentedBuilder(engine);
    const {platform, vm, call} = builder;
    let armed = true;
    try {
      vm.onWrite = event => {
        if (armed && event.kind === 'array') {
          armed = false;
          call('Clear');
          platform.heap.collect();
          assert.equal(platform.native(event.oldValue), 'cd\udc00');
          assert.equal(platform.native(event.value), 'cZ\udc00');
        }
      };
      call('set_Chars', ['int', 'char'], [5, 90]);
      assert.equal(armed, false);
      vm.onWrite = null;
      assert.equal(platform.native(call('ToString')), '');
      assert.equal(call('get_Length'), 0);
      assert.equal(platform.heap.pins.length, 0);
    } finally { vm.onWrite = null; builder.stop(); }
  });

  test(`StringBuilder indexer ${engine}: OOM leaves the original chunk and successful appends remain usable`, () => {
    const builder = segmentedBuilder(engine);
    const {platform, reference, call} = builder;
    const {heap} = platform;
    const storage = platform.get(reference, '$data');
    const chunks = [...heap.get(storage).data];
    const budget = heap.maxBytes;
    const version = platform.get(reference, '$version');
    try {
      heap.maxBytes = 1;
      assert.throws(() => call('set_Chars', ['int', 'char'], [3, 65]), {name: 'OutOfMemoryException'});
      heap.maxBytes = budget;
      assert.deepEqual(heap.get(storage).data, chunks);
      assert.equal(platform.get(reference, '$version'), version);
      assert.equal(platform.native(call('ToString')), 'ab\0\ud800cd\udc00');
      call('Append', ['char'], [33]);
      assert.equal(call('get_Chars', ['int'], [7]), 33);
      assert.equal(heap.pins.length, 0);
    } finally { heap.maxBytes = budget; builder.stop(); }
  });

  test(`StringBuilder indexer ${engine}: reentrant Append can grow backing storage without losing the replacement`, () => {
    const builder = segmentedBuilder(engine);
    const {platform, vm, reference, call} = builder;
    const storage = platform.get(reference, '$data');
    const version = platform.get(reference, '$version');
    let armed = true;
    try {
      vm.onWrite = event => {
        if (armed && event.kind === 'array') {
          armed = false;
          call('Append', ['char'], [33]);
          platform.heap.collect();
          assert.equal(platform.native(event.oldValue), 'cd\udc00');
          assert.equal(platform.native(event.value), 'cZ\udc00');
          assert.equal(platform.heap.get(storage).kind, 'array');
        }
      };
      call('set_Chars', ['int', 'char'], [5, 90]);
      vm.onWrite = null;
      assert.equal(armed, false);
      assert.notDeepEqual(platform.get(reference, '$data'), storage);
      assert.equal(platform.get(reference, '$version'), version + 2);
      assert.equal(platform.native(call('ToString')), 'ab\0\ud800cZ\udc00!');
      assert.equal(platform.heap.pins.length, 0);
    } finally { vm.onWrite = null; builder.stop(); }
  });

  test(`StringBuilder indexer ${engine}: throwing observers retain the written character and release all temporary roots`, () => {
    const builder = segmentedBuilder(engine);
    const {platform, vm, call} = builder;
    const revision = platform.heap.mutationRevision;
    const failure = new Error('Indexer observer failed');
    try {
      vm.onWrite = event => {
        platform.heap.collect();
        if (event.kind === 'array') throw failure;
      };
      assert.throws(() => call('set_Chars', ['int', 'char'], [2, 65]), error => error === failure);
      vm.onWrite = null;
      assert.equal(call('get_Chars', ['int'], [2]), 65);
      assert(platform.heap.mutationRevision > revision);
      assert.equal(platform.heap.pins.length, 0);
    } finally { vm.onWrite = null; builder.stop(); }
  });

  test(`StringBuilder indexer ${engine}: host scalar guards retain native index and receiver precedence`, () => {
    const builder = segmentedBuilder(engine);
    const {platform, call} = builder;
    try {
      for (const index of [NaN, Infinity, 1.5]) {
        assert.throws(() => call('get_Chars', ['int'], [index]), {name: 'IndexOutOfRangeException'});
        assert.throws(() => call('set_Chars', ['int', 'char'], [index, 65]), {name: 'ArgumentOutOfRangeException'});
      }
      for (const value of [-1, 65536, NaN, 1.5]) {
        assert.throws(() => call('set_Chars', ['int', 'char'], [0, value]), {name: 'ArgumentOutOfRangeException'});
      }
      assert.throws(() => call('set_Chars', ['int', 'char'], [-1, -1]), error => {
        assert.match(error.message, /Parameter 'index'/);
        return true;
      });
      assert.throws(() => platform.invoke(builderContract('set_Chars', ['int', 'char']), [null, -1, -1]),
        {name: 'NullReferenceException'});
    } finally { builder.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringBuilder indexer ${pipeline}/${engine}: source brackets use actual Chars getter/setter and evaluate once`, () => {
      const program = compileToIL(`using System; using System.Text;
        class Program {
          static int calls;
          static StringBuilder Receiver(StringBuilder value) { calls++; return value; }
          static int Index() { calls++; return 1; }
          static void Main() {
            var builder = new StringBuilder("ab"); builder.Append('\\uD800').Append('\\uDC00');
            Receiver(builder)[Index()] = '\\u0000'; Console.WriteLine(calls);
            Console.WriteLine((int)builder[0]); Console.WriteLine((int)builder[1]);
            Console.WriteLine((int)builder[2]); Console.WriteLine((int)builder[3]);
            builder[0] = '\\uFFFF'; Console.WriteLine((int)builder[0]); Console.WriteLine(builder.Length);
            try { Console.WriteLine((int)builder[-1]); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            try { builder[4] = 'A'; } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            StringBuilder missing = null;
            try { missing[-1] = 'A'; } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
          }
        }`, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '2\n97\n0\n55296\n56320\n65535\n4\nIndexOutOfRangeException\n' +
          'ArgumentOutOfRangeException\nNullReferenceException\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringBuilder indexer appends exact accessor IDs and preserves native reference provenance', () => {
  assert.equal(builderContract('get_Chars', ['int']).id, 524312);
  assert.equal(builderContract('set_Chars', ['int', 'char']).id, 524313);
  assert.equal(builderContract('Append', ['char', 'int']).id, 524310);
  const search = findContracts('System.String', 'IndexOf')
    .find(row => row.parameters.join(',') === 'string,int,int,System.StringComparison');
  assert.equal(search.id, 524311);
  assert.equal(frameworkType('System.Text.StringBuilder').defaultMember, 'Chars');
  assert.equal(native.rows.length, 44);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  const source = readFileSync(new URL('string-builder-indexer/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
