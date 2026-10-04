import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {MAX} from '@sharpforge/bcl-core';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderPlatform, builderContract} from './fixtures/string-builder/append-char.js';
import {builderInt64Assembly, int64Literal} from './fixtures/string-builder/append-int64.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-append-int64-net10.json', directory), 'utf8'));

test('StringBuilder Int64 Append: source platform matches native exact values, identity and null precedence', () => {
  for (const row of native.rows) {
    const builder = builderPlatform('source', row.initial);
    const {platform, reference, call} = builder;
    try {
      const invoke = () => platform.invoke(builderContract('Append', [row.type]),
        [row.nullReceiver ? null : reference, BigInt(row.input)]);
      if (row.fault) assert.throws(invoke, {name: row.fault});
      else {
        assert.deepEqual(invoke(), reference);
        assert.equal(platform.native(call('ToString')), row.output);
        assert.equal(call('get_Length'), row.length);
      }
    } finally { builder.stop(); }
  }
});

test('StringBuilder Int64 Append: independent CIL preserves signed values and the complete unsigned upper half', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderInt64Assembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.type + ':' + row.input + ':' + result.fault?.stack);
      if (row.fault) assert.equal(result.fault.name, row.fault);
      else {
        assert.equal(Boolean(vm.statics.get(0x04000002)), row.same);
        const reference = vm.statics.get(0x04000001);
        assert.equal(vm.platform.native(vm.platform.invoke(builderContract('ToString'), [reference])), row.output);
      }
    } finally { vm.stop(); }
  }
});

for (const engine of ['source', 'cil']) {
  test(`StringBuilder Int64 Append ${engine}: declared unsigned type reinterprets high-bit stack patterns exactly`, () => {
    const builder = builderPlatform(engine, '');
    const {platform, call} = builder;
    try {
      call('Append', ['ulong'], [-9223372036854775808n]);
      call('Append', ['char'], [124]);
      call('Append', ['ulong'], [-1n]);
      call('Append', ['char'], [124]);
      call('Append', ['long'], [-1n]);
      assert.equal(platform.native(call('ToString')), '9223372036854775808|18446744073709551615|-1');
    } finally { builder.stop(); }
  });

  test(`StringBuilder Int64 Append ${engine}: existing chunks, GC and snapshots retain every digit`, () => {
    const builder = builderPlatform(engine);
    const {platform, vm, reference, call} = builder;
    const {heap} = platform;
    const storage = platform.get(reference, '$data');
    const allocations = heap.stats.allocations;
    const version = platform.get(reference, '$version');
    let writes = 0;
    try {
      vm.onWrite = event => { if (event.kind === 'array') writes++; heap.collect(); };
      call('Append', ['long'], [-9223372036854775808n]);
      call('Append', ['ulong'], [18446744073709551615n]);
      assert.equal(writes, 2);
      assert.equal(heap.stats.allocations - allocations, 2);
      assert.deepEqual(platform.get(reference, '$data'), storage);
      assert.equal(platform.get(reference, '$version'), version + 2);
      assert.equal(heap.pins.length, 0);
      vm.onWrite = null;
      const snapshot = heap.snapshot();
      call('Append', ['long'], [0n]);
      heap.restore(snapshot);
      assert.equal(platform.native(call('ToString')), 'seed|-922337203685477580818446744073709551615');
    } finally { vm.onWrite = null; builder.stop(); }
  });

  test(`StringBuilder Int64 Append ${engine}: managed and host text budgets preserve the completed prefix`, () => {
    const builder = builderPlatform(engine);
    const {platform, reference, call} = builder;
    const {heap} = platform;
    const budget = heap.maxBytes;
    try {
      heap.maxBytes = 1;
      assert.throws(() => call('Append', ['ulong'], [18446744073709551615n]), {name: 'OutOfMemoryException'});
      heap.maxBytes = budget;
      assert.equal(platform.native(call('ToString')), 'seed|');
      call('set_Length', ['int'], [MAX - 20]);
      call('Append', ['long'], [-9223372036854775808n]);
      const version = platform.get(reference, '$version');
      assert.equal(call('get_Length'), MAX);
      assert.throws(() => call('Append', ['ulong'], [0n]), {name: 'OutOfMemoryException'});
      assert.equal(call('get_Length'), MAX);
      assert.equal(platform.get(reference, '$version'), version);
      assert.equal(heap.pins.length, 0);
    } finally { heap.maxBytes = budget; builder.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringBuilder Int64 Append ${pipeline}/${engine}: typed source locals preserve exact native output and fluent controls`, () => {
      const rows = native.rows.filter(row => !row.nullReceiver);
      const cases = rows.map((row, index) => `
        ${row.type} value${index} = ${int64Literal(row)};
        var builder${index} = new StringBuilder(${JSON.stringify(row.initial)});
        Console.WriteLine(builder${index}.Append(value${index}).ToString());`).join('\n');
      const program = compileToIL(`using System; using System.Text;
        ${cases}
        long signed = long.MinValue; ulong unsigned = ulong.MaxValue;
        var builder = new StringBuilder();
        var returned = builder.Append(signed).Append('|').Append(unsigned).Append('|').Append(42).Append(true);
        Console.WriteLine(builder.ToString()); Console.WriteLine(object.ReferenceEquals(builder, returned));
        StringBuilder missing = null;
        try { missing.Append(signed); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
        try { missing.Append(unsigned); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
      `, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, rows.map(row => row.output).join('\n') + '\n' + native.fluent.output +
          '\nTrue\nNullReferenceException\nNullReferenceException\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringBuilder Int64 Append appends contracts without moving existing scalar or CopyTo IDs', () => {
  assert.equal(builderContract('Append', ['long']).id, 524316);
  assert.equal(builderContract('Append', ['ulong']).id, 524317);
  assert.equal(builderContract('CopyTo', ['int', 'char[]', 'int', 'int']).id, 524315);
  assert.equal(builderContract('Append', ['char']).id, 524309);
  assert.equal(builderContract('Append', ['int']).id, 804);
  assert.equal(builderContract('Append', ['bool']).id, 806);
  assert.equal(native.rows.length, 26);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.fluent.same, true);
  for (const row of native.rows) assert.equal(typeof row.input, 'string');
  const source = readFileSync(new URL('string-builder-append-int64/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
