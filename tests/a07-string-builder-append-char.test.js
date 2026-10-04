import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {MAX} from '@sharpforge/bcl-core';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderPlatform, builderContract, units, appendParameters, appendArguments,
  appendCharacterAssembly} from './fixtures/string-builder/append-char.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-append-char-net10.json', directory), 'utf8'));

function assertFault(error, row) {
  assert.equal(error.name, row.fault, row.id);
  if (row.parameter) assert(error.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + error.message);
  return true;
}

test('StringBuilder character append: source platform matches all native UTF-16, identity and boundary rows', () => {
  for (const row of native.rows) {
    const builder = builderPlatform('source', String.fromCharCode(...row.initial));
    const {platform, reference, call} = builder;
    try {
      const invoke = () => platform.invoke(builderContract('Append', appendParameters(row)),
        [row.nullReceiver ? null : reference, ...appendArguments(row)]);
      if (row.fault) assert.throws(invoke, error => assertFault(error, row));
      else assert.deepEqual(invoke(), reference, row.id);
      if (!row.nullReceiver) {
        assert.deepEqual(units(platform.native(call('ToString'))), row.output, row.id);
        assert.equal(call('get_Length'), row.length, row.id);
        assert.equal(call('get_MaxCapacity'), row.maxCapacity, row.id);
        if (row.length <= row.capacityBefore) assert.equal(call('get_Capacity'), row.capacity, row.id);
      }
    } finally { builder.stop(); }
  }
});

test('StringBuilder character append: independent CIL matches every native callvirt outcome', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(appendCharacterAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) assertFault(result.fault, row);
      else assert.equal(Boolean(vm.statics.get(0x04000002)), row.same, row.id);
      const reference = vm.statics.get(0x04000001);
      const actual = reference === null ? null : units(vm.platform.native(vm.platform.invoke(builderContract('ToString'), [reference])));
      assert.deepEqual(actual, row.output, row.id);
    } finally { vm.stop(); }
  }
});

for (const engine of ['source', 'cil']) {
  test(`StringBuilder character append ${engine}: zero repeat is a true no-op on empty and populated builders`, () => {
    for (const initial of ['', 'seed|']) {
      const builder = builderPlatform(engine, initial);
      const {platform, vm, reference, call} = builder;
      const {heap} = platform;
      const state = [heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision,
        platform.get(reference, '$version'), platform.get(reference, '$data')];
      let writes = 0;
      try {
        vm.onWrite = () => { writes++; };
        assert.deepEqual(call('Append', ['char', 'int'], [0xd800, 0]), reference);
        assert.equal(writes, 0);
        assert.deepEqual([heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision,
          platform.get(reference, '$version'), platform.get(reference, '$data')], state);
        assert.equal(platform.native(call('ToString')), initial);
      } finally { vm.onWrite = null; builder.stop(); }
    }
  });

  test(`StringBuilder character append ${engine}: one repeat chunk survives observer GC and snapshot restoration`, () => {
    const builder = builderPlatform(engine);
    const {platform, vm, reference, call} = builder;
    const {heap} = platform;
    const storage = platform.get(reference, '$data');
    const allocations = heap.stats.allocations;
    const version = platform.get(reference, '$version');
    let writes = 0;
    try {
      vm.onWrite = event => { if (event.kind === 'array') writes++; heap.collect(); };
      assert.deepEqual(call('Append', ['char', 'int'], [0xd800, 4097]), reference);
      assert.equal(heap.stats.allocations - allocations, 1);
      assert.equal(writes, 1);
      assert.deepEqual(platform.get(reference, '$data'), storage);
      assert.equal(platform.get(reference, '$version'), version + 1);
      assert.equal(heap.pins.length, 0);
      vm.onWrite = null;
      const snapshot = heap.snapshot();
      call('Append', ['char'], [0xdc00]);
      heap.restore(snapshot);
      assert.equal(platform.native(call('ToString')), 'seed|' + '\ud800'.repeat(4097));
      call('Append', ['char'], [0xdc00]);
      assert.equal(platform.native(call('ToString')), 'seed|' + '\ud800'.repeat(4097) + '\udc00');
    } finally { vm.onWrite = null; builder.stop(); }
  });

  test(`StringBuilder character append ${engine}: receiver, scalar and MaxCapacity guards precede host allocation`, () => {
    const builder = builderPlatform(engine);
    const {platform, reference, call} = builder;
    const allocations = platform.heap.stats.allocations;
    try {
      for (const value of [-1, 65536, 1.5, NaN, Infinity]) {
        assert.throws(() => call('Append', ['char'], [value]), {name: 'ArgumentOutOfRangeException'});
      }
      for (const count of [-1, -2147483648, 1.5, NaN, Infinity, 2147483648, 2147483647]) {
        assert.throws(() => call('Append', ['char', 'int'], [65, count]), error => {
          assert.equal(error.name, 'ArgumentOutOfRangeException');
          assert.match(error.message, /Parameter 'repeatCount'/);
          return true;
        });
      }
      assert.throws(() => platform.invoke(builderContract('Append', ['char', 'int']), [null, 65, -1]),
        {name: 'NullReferenceException'});
      assert.throws(() => call('Append', ['char', 'int'], [65, MAX]), {name: 'OutOfMemoryException'});
      assert.equal(platform.heap.stats.allocations, allocations);
      assert.equal(platform.native(call('ToString')), 'seed|');
      assert.equal(platform.get(reference, '$length'), 5);
    } finally { builder.stop(); }
  });

  test(`StringBuilder character append ${engine}: host boundary accepts exact length and preserves it on overflow`, () => {
    const builder = builderPlatform(engine, '');
    const {platform, call} = builder;
    try {
      call('Append', ['char', 'int'], [0, MAX - 1]);
      call('Append', ['char'], [0xffff]);
      assert.equal(call('get_Length'), MAX);
      assert.throws(() => call('Append', ['char'], [65]), {name: 'OutOfMemoryException'});
      assert.equal(call('get_Length'), MAX);
      const text = platform.native(call('ToString'));
      assert.equal(text.length, MAX);
      assert.equal(text.charCodeAt(MAX - 1), 0xffff);
    } finally { builder.stop(); }
  });

  test(`StringBuilder character append ${engine}: managed OOM keeps the completed prefix and releases roots`, () => {
    const builder = builderPlatform(engine);
    const {platform, call} = builder;
    const budget = platform.heap.maxBytes;
    try {
      platform.heap.maxBytes = 1;
      assert.throws(() => call('Append', ['char', 'int'], [65, 64]), {name: 'OutOfMemoryException'});
      platform.heap.maxBytes = budget;
      assert.equal(platform.native(call('ToString')), 'seed|');
      assert.equal(platform.heap.pins.length, 0);
    } finally { platform.heap.maxBytes = budget; builder.stop(); }
  });

  test(`StringBuilder character append ${engine}: throwing observers retain released nontransactional chunk semantics`, () => {
    const builder = builderPlatform(engine);
    const {platform, vm, call} = builder;
    const failure = new Error('Character append observer failed');
    try {
      vm.onWrite = event => { platform.heap.collect(); if (event.kind === 'array') throw failure; };
      assert.throws(() => call('Append', ['char', 'int'], [65, 64]), error => error === failure);
      vm.onWrite = null;
      assert.equal(platform.heap.pins.length, 0);
      assert.equal(platform.native(call('ToString')), 'seed|');
      call('Append', ['char'], [66]);
      assert.equal(platform.native(call('ToString')), 'seed|B');
    } finally { vm.onWrite = null; builder.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringBuilder character append ${pipeline}/${engine}: exact overloads, fluent identity and released scalar controls`, () => {
      const program = compileToIL(`using System; using System.Text;
        var builder = new StringBuilder();
        var returned = builder.Append('\\u0000').Append('\\uD800', 2).Append('\\uFFFF');
        Console.WriteLine(object.ReferenceEquals(builder, returned)); Console.WriteLine(builder.Length);
        Console.WriteLine((int)builder.ToString()[0]); Console.WriteLine((int)builder.ToString()[1]);
        Console.WriteLine((int)builder.ToString()[2]); Console.WriteLine((int)builder.ToString()[3]);
        builder.Clear(); builder.Append(true).Append(65).Append("!"); Console.WriteLine(builder.ToString());
        try { builder.Append('A', -1); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
        StringBuilder missing = null;
        try { missing.Append('A', -1); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
      `, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\n4\n0\n55296\n55296\n65535\nTrue65!\nArgumentOutOfRangeException\nNullReferenceException\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringBuilder character append adds two tail contracts and pins exact native evidence', () => {
  assert.equal(builderContract('Append', ['char']).id, 524309);
  assert.equal(builderContract('Append', ['char', 'int']).id, 524310);
  assert.equal(builderContract('AppendFormat', ['string', 'object[]']).id, 524288);
  const indexOf = findContracts('System.String', 'IndexOf')
    .find(row => row.parameters.join(',') === 'string,int,System.StringComparison');
  assert.equal(indexOf.id, 524308);
  assert.equal(native.rows.length, 37);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  const source = readFileSync(new URL('string-builder-append-char/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
