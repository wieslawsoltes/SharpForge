import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {disassemble, frameworkBuiltin} from '@sharpforge/bytecode';
import {MAX} from '@sharpforge/bcl-core';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderPlatform, builderContract} from './fixtures/string-builder/append-char.js';
import {integerTypes, integerLiteral, builderIntegerAssembly} from './fixtures/string-builder/append-integers.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-append-integers-net10.json', directory), 'utf8'));

test('StringBuilder small-integer Append: source platform matches native values, identity and null receivers', () => {
  for (const row of native.rows) {
    const builder = builderPlatform('source', row.initial);
    const {platform, reference, call} = builder;
    try {
      const invoke = () => platform.invoke(builderContract('Append', [row.type]),
        [row.nullReceiver ? null : reference, Number(row.input)]);
      if (row.fault) assert.throws(invoke, {name: row.fault});
      else {
        assert.deepEqual(invoke(), reference);
        assert.equal(platform.native(call('ToString')), row.output);
        assert.equal(call('get_Length'), row.length);
      }
    } finally { builder.stop(); }
  }
});

test('StringBuilder small-integer Append: independent CIL preserves narrow values and unsigned I4 high bits', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderIntegerAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.type + ':' + row.input + ':' + result.fault?.stack);
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
  test(`StringBuilder small-integer Append ${engine}: declared uint reinterprets high bits while int and char keep their meaning`, () => {
    const builder = builderPlatform(engine, '');
    const {platform, call} = builder;
    try {
      call('Append', ['uint'], [-2147483648]);
      call('Append', ['char'], [124]);
      call('Append', ['uint'], [-1]);
      call('Append', ['char'], [124]);
      call('Append', ['int'], [-1]);
      call('Append', ['char'], [65]);
      assert.equal(platform.native(call('ToString')), '2147483648|4294967295|-1A');
    } finally { builder.stop(); }
  });

  test(`StringBuilder small-integer Append ${engine}: each typed append reuses one rooted chunk and preserves snapshots`, () => {
    for (const type of integerTypes) {
      const row = native.rows.find(item => item.type === type && !item.nullReceiver);
      const builder = builderPlatform(engine, row.initial);
      const {platform, vm, reference, call} = builder;
      const {heap} = platform;
      const storage = platform.get(reference, '$data');
      const allocations = heap.stats.allocations;
      const version = platform.get(reference, '$version');
      let writes = 0;
      try {
        vm.onWrite = event => { if (event.kind === 'array') writes++; heap.collect(); };
        assert.deepEqual(call('Append', [type], [Number(row.input)]), reference);
        assert.equal(writes, 1);
        assert.equal(heap.stats.allocations - allocations, 1);
        assert.deepEqual(platform.get(reference, '$data'), storage);
        assert.equal(platform.get(reference, '$version'), version + 1);
        assert.equal(heap.pins.length, 0);
        vm.onWrite = null;
        const snapshot = heap.snapshot();
        call('Clear');
        heap.restore(snapshot);
        assert.equal(platform.native(call('ToString')), row.output);
      } finally { vm.onWrite = null; builder.stop(); }
    }
  });

  test(`StringBuilder small-integer Append ${engine}: allocation and host text budgets retain completed text`, () => {
    const builder = builderPlatform(engine);
    const {platform, reference, call} = builder;
    const {heap} = platform;
    const budget = heap.maxBytes;
    try {
      heap.maxBytes = 1;
      assert.throws(() => call('Append', ['uint'], [-1]), {name: 'OutOfMemoryException'});
      heap.maxBytes = budget;
      assert.equal(platform.native(call('ToString')), 'seed|');
      call('set_Length', ['int'], [MAX - 10]);
      call('Append', ['uint'], [-1]);
      assert.equal(call('get_Length'), MAX);
      const version = platform.get(reference, '$version');
      for (const type of integerTypes) {
        assert.throws(() => call('Append', [type], [0]), {name: 'OutOfMemoryException'});
      }
      assert.equal(call('get_Length'), MAX);
      assert.equal(platform.get(reference, '$version'), version);
      assert.equal(heap.pins.length, 0);
    } finally { heap.maxBytes = budget; builder.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringBuilder small-integer Append ${pipeline}/${engine}: typed locals select exact overloads and match native output`, () => {
      const rows = native.rows.filter(row => !row.nullReceiver);
      const cases = rows.map((row, index) => `
        ${row.type} value${index} = ${integerLiteral(row)};
        var builder${index} = new StringBuilder(${JSON.stringify(row.initial)});
        Console.WriteLine(builder${index}.Append(value${index}).ToString());`).join('\n');
      const program = compileToIL(`using System; using System.Text;
        ${cases}
        sbyte signedByte = -128; byte unsignedByte = 255;
        short signedShort = -32768; ushort unsignedShort = 65535; uint unsignedInt = uint.MaxValue;
        var builder = new StringBuilder();
        var returned = builder.Append(signedByte).Append('|').Append(unsignedByte).Append('|')
          .Append(signedShort).Append('|').Append(unsignedShort).Append('|').Append(unsignedInt).Append('|').Append(42).Append('A');
        Console.WriteLine(builder.ToString()); Console.WriteLine(object.ReferenceEquals(builder, returned));
        StringBuilder missing = null;
        try { missing.Append(signedByte); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
        try { missing.Append(unsignedByte); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
        try { missing.Append(signedShort); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
        try { missing.Append(unsignedShort); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
        try { missing.Append(unsignedInt); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
      `, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const builtinIds = new Set(disassemble(program.image).flatMap(method => method.instructions)
        .filter(instruction => instruction.op === 'BUILTIN').map(instruction => instruction.a));
      for (const type of integerTypes) assert(builtinIds.has(frameworkBuiltin(builderContract('Append', [type])).id), type);
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, rows.map(row => row.output).join('\n') + '\n' + native.fluent.output +
          '\nTrue\n' + 'NullReferenceException\n'.repeat(5));
      } finally { vm.stop(); }
    });
  }
}

test('StringBuilder small-integer Append retains preceding IDs and unchanged native provenance', () => {
  for (const [index, type] of integerTypes.entries()) {
    assert.equal(builderContract('Append', [type]).id, 524324 + index);
  }
  assert.equal(builderContract('Append', ['System.Text.StringBuilder']).id, 524323);
  assert.equal(builderContract('Append', ['char[]', 'int', 'int']).id, 524321);
  assert.equal(builderContract('Append', ['long']).id, 524316);
  assert.equal(builderContract('Append', ['char']).id, 524309);
  assert.equal(builderContract('Append', ['int']).id, 804);
  assert.equal(native.rows.length, 53);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.fluent.same, true);
  for (const row of native.rows) assert.equal(typeof row.input, 'string');
  const source = readFileSync(new URL('string-builder-append-integers/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
