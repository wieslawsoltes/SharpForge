import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {MAX} from '@sharpforge/bcl-core';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderContract, units} from './fixtures/string-builder/append-char.js';
import {builderPair, builderAppendAssembly, builderParameters, segmentText} from './fixtures/string-builder/append-builder.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-append-builder-net10.json', directory), 'utf8'));
const content = (platform, reference) => reference === null ? null :
  platform.native(platform.invoke(builderContract('ToString'), [reference]));

test('StringBuilder source append: source platform matches native self/null/segmented output and identity', () => {
  for (const row of native.rows) {
    const builder = builderPair('source', segmentText(row.destination), row.source === null ? null : segmentText(row.source));
    const {platform, reference, input} = builder;
    const destination = row.nullReceiver ? null : reference;
    const source = row.self ? destination : input;
    try {
      platform.heap.withRoots([reference, source], () => {
        const invoke = () => platform.invoke(builderContract('Append', builderParameters), [destination, source]);
        if (row.fault) assert.throws(invoke, {name: row.fault}, row.id);
        else assert.deepEqual(invoke(), reference, row.id);
        assert.deepEqual(destination === null ? null : units(content(platform, destination)), row.output, row.id);
        assert.deepEqual(source === null ? null : units(content(platform, source)), row.sourceOutput, row.id);
      });
    } finally { builder.stop(); }
  }
});

test('StringBuilder source append: independent CIL preserves source content, null faults and self references', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderAppendAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) assert.equal(result.fault.name, row.fault, row.id);
      else assert.equal(Boolean(vm.statics.get(0x04000003)), row.same, row.id);
      const destination = vm.statics.get(0x04000001);
      const source = vm.statics.get(0x04000002);
      assert.deepEqual(destination === null ? null : units(content(vm.platform, destination)), row.output, row.id);
      assert.deepEqual(source === null ? null : units(content(vm.platform, source)), row.sourceOutput, row.id);
    } finally { vm.stop(); }
  }
});

for (const engine of ['source', 'cil']) {
  test(`StringBuilder source append ${engine}: null and empty inputs perform no writes or managed allocations`, () => {
    for (const source of [null, [], ['', '']]) {
      const builder = builderPair(engine, ['seed|'], source);
      const {platform, vm, reference, input, call} = builder;
      const {heap} = platform;
      const before = [heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision,
        platform.get(reference, '$version'), platform.get(reference, '$data')];
      const budget = heap.maxBytes;
      let writes = 0;
      try {
        heap.maxBytes = 1;
        vm.onWrite = () => { writes++; };
        assert.deepEqual(call('Append', builderParameters, [input]), reference);
        assert.equal(writes, 0);
        assert.deepEqual([heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision,
          platform.get(reference, '$version'), platform.get(reference, '$data')], before);
      } finally { vm.onWrite = null; heap.maxBytes = budget; builder.stop(); }
    }
  });

  test(`StringBuilder source append ${engine}: self and distinct source copies allocate one rooted chunk and survive snapshots`, () => {
    for (const self of [false, true]) {
      const builder = builderPair(engine);
      const {platform, vm, reference, input, call} = builder;
      const {heap} = platform;
      const source = self ? reference : input;
      const expected = self ? 'seed|seed|' : 'seed|ab\0\ud800cd\udc00';
      const allocations = heap.stats.allocations;
      const version = platform.get(reference, '$version');
      const storage = platform.get(reference, '$data');
      let writes = 0;
      try {
        vm.onWrite = event => { if (event.kind === 'array') writes++; heap.collect(); };
        assert.deepEqual(call('Append', builderParameters, [source]), reference);
        vm.onWrite = null;
        assert.equal(writes, 1);
        assert.equal(heap.stats.allocations - allocations, 1);
        assert.equal(platform.get(reference, '$version'), version + 1);
        assert.deepEqual(platform.get(reference, '$data'), storage);
        assert.equal(heap.pins.length, 0);
        const snapshot = heap.snapshot();
        call('Clear');
        heap.restore(snapshot);
        assert.equal(content(platform, reference), expected);
      } finally { vm.onWrite = null; builder.stop(); }
    }
  });

  test(`StringBuilder source append ${engine}: distinct-source edits during destination notifications preserve captured input`, () => {
    for (const mutation of ['Clear', 'set_Chars', 'Append']) {
      const builder = builderPair(engine);
      const {platform, vm, reference, input, call} = builder;
      let armed = true;
      try {
        vm.onWrite = event => {
          if (armed && event.kind === 'array') {
            armed = false;
            if (mutation === 'Clear') platform.invoke(builderContract('Clear'), [input]);
            else if (mutation === 'set_Chars') platform.invoke(builderContract('set_Chars', ['int', 'char']), [input, 0, 90]);
            else platform.invoke(builderContract('Append', ['char']), [input, 33]);
          }
          platform.heap.collect();
        };
        call('Append', builderParameters, [input]);
        vm.onWrite = null;
        assert.equal(armed, false);
        assert.equal(content(platform, reference), 'seed|ab\0\ud800cd\udc00');
        assert.equal(content(platform, input), mutation === 'Clear' ? '' :
          mutation === 'set_Chars' ? 'Zb\0\ud800cd\udc00' : 'ab\0\ud800cd\udc00!');
        assert.equal(platform.heap.pins.length, 0);
      } finally { vm.onWrite = null; builder.stop(); }
    }
  });

  test(`StringBuilder source append ${engine}: source chunks are read once and destination prefix is never flattened`, () => {
    const builder = builderPair(engine, ['destination|'], Array.from({length: 32}, (_, index) => String.fromCharCode(65 + index)));
    const {platform, reference, input, call} = builder;
    const sourceSlots = platform.heap.get(platform.get(input, '$data')).data;
    const destinationSlots = platform.heap.get(platform.get(reference, '$data')).data;
    const records = [...sourceSlots.slice(0, 32), destinationSlots[0]].map(value => platform.heap.get(value));
    const values = records.map(record => record.data);
    const reads = new Uint32Array(records.length);
    try {
      records.forEach((record, index) => Object.defineProperty(record, 'data', {
        configurable: true, get() { reads[index]++; return values[index]; }
      }));
      call('Append', builderParameters, [input]);
      assert.deepEqual([...reads], [...Array(32).fill(1), 0]);
    } finally {
      records.forEach((record, index) => Object.defineProperty(record, 'data', {
        configurable: true, writable: true, enumerable: true, value: values[index]
      }));
      builder.stop();
    }
  });

  test(`StringBuilder source append ${engine}: combined length is checked before source traversal and failed allocation preserves builders`, () => {
    const builder = builderPair(engine, ['seed|'], ['ab']);
    const {platform, reference, input, call} = builder;
    const {heap} = platform;
    const budget = heap.maxBytes;
    try {
      heap.maxBytes = 1;
      assert.throws(() => call('Append', builderParameters, [input]), {name: 'OutOfMemoryException'});
      heap.maxBytes = budget;
      assert.equal(content(platform, reference), 'seed|');
      assert.equal(content(platform, input), 'ab');
      heap.withRoots([input], () => call('set_Length', ['int'], [MAX - 1]));
      const chunk = heap.get(heap.get(platform.get(input, '$data')).data[0]);
      const text = chunk.data;
      let reads = 0;
      try {
        Object.defineProperty(chunk, 'data', {configurable: true, get() { reads++; return text; }});
        assert.throws(() => call('Append', builderParameters, [input]), {name: 'OutOfMemoryException'});
        assert.equal(reads, 0);
        assert.equal(call('get_Length'), MAX - 1);
      } finally { Object.defineProperty(chunk, 'data', {configurable: true, enumerable: true, writable: true, value: text}); }
      assert.equal(heap.pins.length, 0);
    } finally { heap.maxBytes = budget; builder.stop(); }
  });

  test(`StringBuilder source append ${engine}: observer failure retains existing partial append semantics and releases roots`, () => {
    const builder = builderPair(engine);
    const {platform, vm, reference, input, call} = builder;
    const failure = new Error('Source-builder append observer failed');
    try {
      vm.onWrite = event => { platform.heap.collect(); if (event.kind === 'array') throw failure; };
      assert.throws(() => call('Append', builderParameters, [input]), error => error === failure);
      vm.onWrite = null;
      assert.equal(content(platform, reference), 'seed|');
      assert.equal(content(platform, input), 'ab\0\ud800cd\udc00');
      assert.equal(platform.heap.pins.length, 0);
      call('Append', ['char'], [66]);
      assert.equal(content(platform, reference), 'seed|B');
    } finally { vm.onWrite = null; builder.stop(); }
  });

  test(`StringBuilder source append ${engine}: malformed host source references cannot masquerade as empty builders`, () => {
    const builder = builderPair(engine);
    const {platform, call} = builder;
    try {
      for (const source of [platform.heap.string('wrong'), platform.make('System.Uri')]) {
        assert.throws(() => call('Append', builderParameters, [source]), {name: 'InvalidCastException'});
      }
      assert.equal(platform.native(call('ToString')), 'seed|');
    } finally { builder.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringBuilder source append ${pipeline}/${engine}: typed builders bind without ToString conversion and evaluate once`, () => {
      const program = compileToIL(`using System; using System.Text;
        class Program {
          static int calls;
          static StringBuilder Receiver(StringBuilder value) { calls = calls * 10 + 1; return value; }
          static StringBuilder Source(StringBuilder value) { calls = calls * 10 + 2; return value; }
          static void Main() {
            var destination = new StringBuilder("seed|");
            var source = new StringBuilder("a\\0"); source.Append('\\uD800').Append('\\uDC00');
            var returned = Receiver(destination).Append(Source(source));
            Console.WriteLine(calls); Console.WriteLine(object.ReferenceEquals(destination, returned));
            string output = destination.ToString();
            for (int index = 0; index < output.Length; index++) Console.WriteLine((int)output[index]);
            Console.WriteLine(source.Length); destination.Append(destination); Console.WriteLine(destination.Length);
            StringBuilder missing = null; destination.Append(missing); Console.WriteLine(destination.Length);
            try { missing.Append(source); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            var empty = new StringBuilder(); empty.Append(empty); Console.WriteLine(empty.Length);
          }
        }`, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '12\nTrue\n115\n101\n101\n100\n124\n97\n0\n55296\n56320\n4\n18\n18\nNullReferenceException\n0\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringBuilder source append adds one ordered contract and preserves native provenance', () => {
  assert.equal(builderContract('Append', builderParameters).id, 524323);
  assert.equal(builderContract('Append', ['string', 'int', 'int']).id, 524319);
  assert.equal(builderContract('Append', ['char[]']).id, 524320);
  assert.equal(builderContract('Append', ['char[]', 'int', 'int']).id, 524321);
  assert.equal(native.rows.length, 21);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  const source = readFileSync(new URL('string-builder-append-builder/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
