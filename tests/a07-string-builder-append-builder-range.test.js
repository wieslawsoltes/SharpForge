import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {disassemble, frameworkBuiltin} from '@sharpforge/bytecode';
import {MAX} from '@sharpforge/bcl-core';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderContract, units} from './fixtures/string-builder/append-char.js';
import {builderPair, segmentText} from './fixtures/string-builder/append-builder.js';
import {builderRangeAssembly, builderRangeParameters, builderRangeSource} from './fixtures/string-builder/append-builder-range.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-append-builder-range-net10.json', directory), 'utf8'));
const content = (platform, reference) => reference === null ? null :
  platform.native(platform.invoke(builderContract('ToString'), [reference]));

function assertFault(error, row) {
  assert.equal(error.name, row.fault, row.id);
  if (row.parameter) assert(error.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + error.message);
  else assert.equal(error.message.includes("(Parameter '"), false, row.id + ': ' + error.message);
  return true;
}

test('StringBuilder builder-range append: source platform matches native content, identity and validation precedence', () => {
  for (const row of native.rows) {
    const builder = builderPair('source', segmentText(row.destination), row.source === null ? null : segmentText(row.source));
    const {platform, reference, input} = builder;
    const destination = row.nullReceiver ? null : reference;
    const source = row.self ? destination : input;
    try {
      platform.heap.withRoots([reference, source], () => {
        const invoke = () => platform.invoke(builderContract('Append', builderRangeParameters),
          [destination, source, row.startIndex, row.count]);
        if (row.fault) assert.throws(invoke, error => assertFault(error, row));
        else assert.deepEqual(invoke(), reference, row.id);
        assert.deepEqual(destination === null ? null : units(content(platform, destination)), row.output, row.id);
        assert.deepEqual(source === null ? null : units(content(platform, source)), row.sourceOutput, row.id);
        if (destination !== null) assert.equal(platform.invoke(builderContract('get_Length'), [destination]), row.length, row.id);
      });
    } finally { builder.stop(); }
  }
});

test('StringBuilder builder-range append: independent CIL preserves native ranges, self references and faults', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderRangeAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) assertFault(result.fault, row);
      else assert.equal(Boolean(vm.statics.get(0x04000003)), row.same, row.id);
      const destination = vm.statics.get(0x04000001);
      const source = vm.statics.get(0x04000002);
      assert.deepEqual(destination === null ? null : units(content(vm.platform, destination)), row.output, row.id);
      assert.deepEqual(source === null ? null : units(content(vm.platform, source)), row.sourceOutput, row.id);
    } finally { vm.stop(); }
  }
});

for (const engine of ['source', 'cil']) {
  test(`StringBuilder builder-range append ${engine}: valid zero counts need no writes or managed allocation budget`, () => {
    for (const row of native.rows.filter(item => !item.fault && item.count === 0)) {
      const builder = builderPair(engine, segmentText(row.destination), row.source === null ? null : segmentText(row.source));
      const {platform, vm, reference, input, call} = builder;
      const {heap} = platform;
      const state = [heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision,
        platform.get(reference, '$version'), platform.get(reference, '$data')];
      const budget = heap.maxBytes;
      let writes = 0;
      try {
        heap.maxBytes = 1;
        vm.onWrite = () => { writes++; };
        assert.deepEqual(call('Append', builderRangeParameters, [row.self ? reference : input, row.startIndex, 0]), reference, row.id);
        assert.equal(writes, 0, row.id);
        assert.deepEqual([heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision,
          platform.get(reference, '$version'), platform.get(reference, '$data')], state, row.id);
      } finally { vm.onWrite = null; heap.maxBytes = budget; builder.stop(); }
    }
  });

  test(`StringBuilder builder-range append ${engine}: self and distinct ranges allocate one rooted chunk and survive snapshots`, () => {
    for (const self of [false, true]) {
      const builder = builderPair(engine);
      const {platform, vm, reference, input, call} = builder;
      const {heap} = platform;
      const allocations = heap.stats.allocations;
      const version = platform.get(reference, '$version');
      const storage = platform.get(reference, '$data');
      let writes = 0;
      try {
        vm.onWrite = event => { if (event.kind === 'array') writes++; heap.collect(); };
        assert.deepEqual(call('Append', builderRangeParameters, [self ? reference : input, 1, 3]), reference);
        vm.onWrite = null;
        assert.equal(writes, 1);
        assert.equal(heap.stats.allocations - allocations, 1);
        assert.equal(platform.get(reference, '$version'), version + 1);
        assert.deepEqual(platform.get(reference, '$data'), storage);
        assert.equal(heap.pins.length, 0);
        const snapshot = heap.snapshot();
        call('Clear');
        heap.restore(snapshot);
        assert.equal(content(platform, reference), self ? 'seed|eed' : 'seed|b\0\ud800');
      } finally { vm.onWrite = null; builder.stop(); }
    }
  });

  test(`StringBuilder builder-range append ${engine}: source mutations during destination writes preserve captured selected text`, () => {
    for (const mutation of ['Clear', 'set_Chars', 'Append']) {
      const builder = builderPair(engine);
      const {platform, vm, reference, input, call} = builder;
      let armed = true;
      try {
        vm.onWrite = event => {
          if (armed && event.kind === 'array') {
            armed = false;
            if (mutation === 'Clear') platform.invoke(builderContract('Clear'), [input]);
            else if (mutation === 'set_Chars') platform.invoke(builderContract('set_Chars', ['int', 'char']), [input, 1, 90]);
            else platform.invoke(builderContract('Append', ['char']), [input, 33]);
          }
          platform.heap.collect();
        };
        call('Append', builderRangeParameters, [input, 1, 3]);
        vm.onWrite = null;
        assert.equal(armed, false);
        assert.equal(content(platform, reference), 'seed|b\0\ud800');
        assert.equal(content(platform, input), mutation === 'Clear' ? '' :
          mutation === 'set_Chars' ? 'aZ\0\ud800cd\udc00' : 'ab\0\ud800cd\udc00!');
        assert.equal(platform.heap.pins.length, 0);
      } finally { vm.onWrite = null; builder.stop(); }
    }
  });

  test(`StringBuilder builder-range append ${engine}: one traversal stops after the selected range without reading destination text`, () => {
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
      call('Append', builderRangeParameters, [input, 17, 6]);
      assert.deepEqual([...reads], [...Array(23).fill(1), ...Array(10).fill(0)]);
      reads.fill(0);
      call('Append', builderRangeParameters, [input, 17, 0]);
      assert.deepEqual([...reads], Array(33).fill(0));
    } finally {
      records.forEach((record, index) => Object.defineProperty(record, 'data', {
        configurable: true, writable: true, enumerable: true, value: values[index]
      }));
      builder.stop();
    }
  });

  test(`StringBuilder builder-range append ${engine}: native range faults and combined host budget precede source traversal`, () => {
    const builder = builderPair(engine, ['seed|'], ['abc']);
    const {platform, reference, input, call} = builder;
    const {heap} = platform;
    const budget = heap.maxBytes;
    try {
      heap.maxBytes = 1;
      assert.throws(() => call('Append', builderRangeParameters, [input, 1, 1]), {name: 'OutOfMemoryException'});
      heap.maxBytes = budget;
      assert.equal(content(platform, reference), 'seed|');
      assert.equal(content(platform, input), 'abc');
      heap.withRoots([input], () => call('set_Length', ['int'], [MAX - 1]));
      const chunk = heap.get(heap.get(platform.get(input, '$data')).data[0]);
      const text = chunk.data;
      const version = platform.get(reference, '$version');
      let reads = 0;
      try {
        Object.defineProperty(chunk, 'data', {configurable: true, get() { reads++; return text; }});
        assert.throws(() => call('Append', builderRangeParameters, [input, -1, 2]), {name: 'ArgumentOutOfRangeException'});
        assert.throws(() => call('Append', builderRangeParameters, [input, 0, 2]), {name: 'OutOfMemoryException'});
        assert.equal(reads, 0);
        assert.equal(call('get_Length'), MAX - 1);
        assert.equal(platform.get(reference, '$version'), version);
      } finally { Object.defineProperty(chunk, 'data', {configurable: true, enumerable: true, writable: true, value: text}); }
      call('Append', builderRangeParameters, [input, 2, 1]);
      assert.equal(call('get_Length'), MAX);
      assert.equal(heap.pins.length, 0);
    } finally { heap.maxBytes = budget; builder.stop(); }
  });

  test(`StringBuilder builder-range append ${engine}: observer failure preserves released partial progress and root cleanup`, () => {
    const builder = builderPair(engine);
    const {platform, vm, reference, input, call} = builder;
    const storage = platform.heap.get(platform.get(reference, '$data')).data;
    const failure = new Error('Builder range append observer failed');
    try {
      vm.onWrite = event => { platform.heap.collect(); if (event.kind === 'array') throw failure; };
      assert.throws(() => call('Append', builderRangeParameters, [input, 1, 3]), error => error === failure);
      vm.onWrite = null;
      assert.equal(platform.native(storage[1]), 'b\0\ud800');
      assert.equal(platform.get(reference, '$count'), 1);
      assert.equal(content(platform, reference), 'seed|');
      assert.equal(content(platform, input), 'ab\0\ud800cd\udc00');
      assert.equal(platform.heap.pins.length, 0);
      call('Append', ['char'], [66]);
      assert.equal(content(platform, reference), 'seed|B');
    } finally { vm.onWrite = null; builder.stop(); }
  });

  test(`StringBuilder builder-range append ${engine}: malformed host sources cannot masquerade as zero-length builders`, () => {
    const builder = builderPair(engine);
    const {platform, call} = builder;
    try {
      for (const source of [platform.heap.string('wrong'), platform.make('System.Uri')]) {
        assert.throws(() => call('Append', builderRangeParameters, [source, 0, 0]), {name: 'InvalidCastException'});
      }
      assert.equal(platform.native(call('ToString')), 'seed|');
    } finally { builder.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringBuilder builder-range append ${pipeline}/${engine}: exact typed calls preserve native content and evaluate once`, () => {
      const ids = ['complete-units', 'nul-and-pair', 'isolated-high', 'isolated-low', 'self-empty', 'self-full', 'self-middle',
        'self-past-end-zero', 'self-invalid', 'value-0-range-5', 'value-0-range-10', 'null-receiver-invalid'];
      const rows = ids.map(id => native.rows.find(row => row.id === id));
      const program = compileToIL(`using System; using System.Text;
        class Program {
          static int calls;
          static StringBuilder Receiver(StringBuilder value) { calls = calls * 10 + 1; return value; }
          static StringBuilder Source(StringBuilder value) { calls = calls * 10 + 2; return value; }
          static int Start() { calls = calls * 10 + 3; return 1; }
          static int Count() { calls = calls * 10 + 4; return 2; }
          static void Main() {
            ${builderRangeSource(rows)}
            var target = new StringBuilder("seed|"); var input = new StringBuilder("abcd");
            Receiver(target).Append(Source(input), Start(), Count());
            Console.WriteLine(calls); Console.WriteLine(target.ToString()); Console.WriteLine(input.ToString());
          }
        }`, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const builtin = frameworkBuiltin(builderContract('Append', builderRangeParameters)).id;
      assert(disassemble(program.image).some(method => method.instructions.some(instruction =>
        instruction.op === 'BUILTIN' && instruction.a === builtin)));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      const expected = rows.flatMap(row => [row.fault ?? 'True', ...(row.nullReceiver ? [] : [row.length, ...row.output])]);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, expected.join('\n') + '\n1234\nseed|bc\nabcd\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringBuilder builder-range append adds one tail contract and retains unchanged native provenance', () => {
  assert.equal(builderContract('Append', builderRangeParameters).id, 524333);
  assert.equal(builderContract('Append', ['decimal']).id, 524332);
  assert.equal(builderContract('Equals', ['System.Text.StringBuilder']).id, 524331);
  assert.equal(builderContract('Append', ['System.Text.StringBuilder']).id, 524323);
  assert.equal(builderContract('Append', ['string', 'int', 'int']).id, 524319);
  assert.equal(native.rows.length, 68);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  const source = readFileSync(new URL('string-builder-append-builder-range/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
