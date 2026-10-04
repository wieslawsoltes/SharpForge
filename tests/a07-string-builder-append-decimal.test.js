import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {decimal, decimalBits, disassemble, frameworkBuiltin} from '@sharpforge/bytecode';
import {MAX} from '@sharpforge/bcl-core';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderPlatform, builderContract} from './fixtures/string-builder/append-char.js';
import {decimalLiteral, builderDecimalAssembly} from './fixtures/string-builder/append-decimal.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-append-decimal-net10.json', directory), 'utf8'));
const valueOf = row => decimal(BigInt(row.coefficient), row.scale, row.negative);

test('StringBuilder Decimal Append: source platform matches native text, preserved storage and null receivers', () => {
  for (const row of native.rows) {
    const builder = builderPlatform('source', row.initial);
    const {platform, reference, call} = builder;
    const value = valueOf(row);
    try {
      assert.deepEqual(decimalBits(value), row.bits);
      const invoke = () => platform.invoke(builderContract('Append', ['decimal']), [row.nullReceiver ? null : reference, value]);
      if (row.fault) assert.throws(invoke, {name: row.fault});
      else {
        assert.deepEqual(invoke(), reference);
        assert.equal(platform.native(call('ToString')), row.output);
        assert.equal(call('get_Length'), row.length);
      }
      assert.deepEqual(decimalBits(value), row.bits);
    } finally { builder.stop(); }
  }
});

test('StringBuilder Decimal Append: independent CIL preserves all native 96-bit values, scale and identity', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderDecimalAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.coefficient + ':' + row.scale + ':' + result.fault?.stack);
      if (row.fault) assert.equal(result.fault.name, row.fault);
      else {
        assert.equal(Boolean(vm.statics.get(0x04000002)), row.same);
        const reference = vm.statics.get(0x04000001);
        assert.equal(vm.platform.native(vm.platform.invoke(builderContract('ToString'), [reference])), row.output);
        assert.equal(vm.platform.invoke(builderContract('get_Length'), [reference]), row.length);
      }
    } finally { vm.stop(); }
  }
});

for (const engine of ['source', 'cil']) {
  test(`StringBuilder Decimal Append ${engine}: scaled zero and trailing zeros remain exact without mutating the carrier`, () => {
    const builder = builderPlatform(engine, '');
    const {platform, call} = builder;
    const value = decimal(0n, 28, true);
    const bits = decimalBits(value);
    try {
      call('Append', ['decimal'], [value]);
      call('Append', ['char'], [124]);
      call('Append', ['decimal'], [decimal(12300n, 4)]);
      assert.equal(platform.native(call('ToString')), '0.' + '0'.repeat(28) + '|1.2300');
      assert.deepEqual(decimalBits(value), bits);
    } finally { builder.stop(); }
  });

  test(`StringBuilder Decimal Append ${engine}: one rooted chunk survives GC and snapshot restore`, () => {
    const builder = builderPlatform(engine);
    const {platform, vm, reference, call} = builder;
    const {heap} = platform;
    const value = decimal(79228162514264337593543950335n, 28, true);
    const storage = platform.get(reference, '$data');
    const allocations = heap.stats.allocations;
    const version = platform.get(reference, '$version');
    let writes = 0;
    try {
      vm.onWrite = event => { if (event.kind === 'array') writes++; heap.collect(); };
      assert.deepEqual(call('Append', ['decimal'], [value]), reference);
      assert.equal(writes, 1);
      assert.equal(heap.stats.allocations - allocations, 1);
      assert.deepEqual(platform.get(reference, '$data'), storage);
      assert.equal(platform.get(reference, '$version'), version + 1);
      assert.equal(heap.pins.length, 0);
      vm.onWrite = null;
      const snapshot = heap.snapshot();
      call('Clear');
      heap.restore(snapshot);
      assert.equal(platform.native(call('ToString')), 'seed|-7.9228162514264337593543950335');
    } finally { vm.onWrite = null; builder.stop(); }
  });

  test(`StringBuilder Decimal Append ${engine}: managed and host text limits retain the completed prefix`, () => {
    const builder = builderPlatform(engine);
    const {platform, reference, call} = builder;
    const {heap} = platform;
    const budget = heap.maxBytes;
    const value = decimal(79228162514264337593543950335n, 0, true);
    try {
      heap.maxBytes = 1;
      assert.throws(() => call('Append', ['decimal'], [value]), {name: 'OutOfMemoryException'});
      heap.maxBytes = budget;
      assert.equal(platform.native(call('ToString')), 'seed|');
      call('set_Length', ['int'], [MAX - 30]);
      call('Append', ['decimal'], [value]);
      assert.equal(call('get_Length'), MAX);
      const version = platform.get(reference, '$version');
      assert.throws(() => call('Append', ['decimal'], [decimal()]), {name: 'OutOfMemoryException'});
      assert.equal(call('get_Length'), MAX);
      assert.equal(platform.get(reference, '$version'), version);
      assert.equal(heap.pins.length, 0);
    } finally { heap.maxBytes = budget; builder.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringBuilder Decimal Append ${pipeline}/${engine}: typed exact literals select Decimal and retain native output`, () => {
      const rows = native.rows.filter(row => !row.nullReceiver);
      const cases = rows.map((row, index) => `
        decimal value${index} = ${decimalLiteral(row)};
        var builder${index} = new StringBuilder(${JSON.stringify(row.initial)});
        Console.WriteLine(builder${index}.Append(value${index}).ToString());`).join('\n');
      const program = compileToIL(`using System; using System.Text;
        ${cases}
        decimal fraction = 1.2300m; decimal negativeZero = -0.000m;
        var builder = new StringBuilder();
        var returned = builder.Append(fraction).Append('|').Append(negativeZero).Append('|').Append(42).Append('A');
        Console.WriteLine(builder.ToString()); Console.WriteLine(object.ReferenceEquals(builder, returned));
        StringBuilder missing = null;
        try { missing.Append(fraction); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
      `, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const builtin = frameworkBuiltin(builderContract('Append', ['decimal'])).id;
      assert(disassemble(program.image).some(method => method.instructions.some(instruction =>
        instruction.op === 'BUILTIN' && instruction.a === builtin)));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, rows.map(row => row.output).join('\n') + '\n' + native.fluent.output +
          '\nTrue\nNullReferenceException\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringBuilder Decimal Append appends at its reserved slot and preserves native source provenance', () => {
  assert.equal(builderContract('Append', ['decimal']).id, 524332);
  assert.equal(builderContract('Equals', ['System.Text.StringBuilder']).id, 524331);
  assert.equal(builderContract('Append', ['float']).id, 524330);
  assert.equal(builderContract('Append', ['uint']).id, 524328);
  assert.equal(builderContract('Append', ['int']).id, 804);
  assert.equal(native.rows.length, 33);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.fluent.same, true);
  for (const row of native.rows) assert.equal(typeof row.coefficient, 'string');
  const source = readFileSync(new URL('string-builder-append-decimal/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
