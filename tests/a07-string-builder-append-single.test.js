import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {float, int32BitsToSingle, singleToInt32Bits, decodeScalar, disassemble, frameworkBuiltin} from '@sharpforge/bytecode';
import {MAX, formatSingleDefault} from '@sharpforge/bcl-core';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderPlatform, builderContract} from './fixtures/string-builder/append-char.js';
import {builderSingleAssembly, singleSourceCases} from './fixtures/string-builder/append-single.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-append-single-net10.json', directory), 'utf8'));
const rows = native.rows.filter(row => !row.nullReceiver);

test('Single default public formatter accepts raw binary32 numbers without changing their storage value', () => {
  for (const row of rows) {
    const carrier = int32BitsToSingle(Number.parseInt(row.bits, 16) | 0);
    const value = carrier.value;
    assert.equal(formatSingleDefault(value), row.text, row.bits);
    assert(Object.is(carrier.value, value), row.bits);
  }
});

for (const engine of ['source', 'cil']) {
  test(`Single append prerequisite ${engine}: existing typed default formatter matches exact native Single bits`, () => {
    const builder = builderPlatform(engine);
    try {
      const actual = rows.map(row => {
        const value = int32BitsToSingle(Number.parseInt(row.bits, 16) | 0);
        assert.equal(builder.vm.format(value.value, 'float'), builder.vm.format(value, 'float'), row.bits);
        return {bits: row.bits, text: builder.vm.format(value, 'float')};
      });
      assert.deepEqual(actual, rows.map(row => ({bits: row.bits, text: row.text})));
    } finally { builder.stop(); }
  });

  test(`Single append prerequisite ${engine}: explicitly widened Double controls retain binary64 output`, () => {
    const builder = builderPlatform(engine);
    try {
      const actual = rows.map(row => {
        const value = int32BitsToSingle(Number.parseInt(row.bits, 16) | 0);
        return {bits: row.bits, text: builder.vm.format(float(value.value, 'r8'), 'double')};
      });
      assert.deepEqual(actual, rows.map(row => ({bits: row.bits, text: row.doubleText})));
    } finally { builder.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`Single append prerequisite ${pipeline}/${engine}: existing typed Console path honors Single notation`, () => {
      const program = compileToIL('using System; float value = 1000000000f; Console.WriteLine(value);', {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        const row = rows.find(value => value.bits === '4e6e6b28');
        assert.equal(result.output, row.text + '\n');
      } finally { vm.stop(); }
    });
  }
}

test('Single append evidence preserves pinned native source and exact-bit input transport', () => {
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.rows.length, 44);
  for (const row of native.rows) {
    assert.match(row.bits, /^[0-9a-f]{8}$/);
    assert.match(row.observedBits, /^[0-9a-f]{8}$/);
  }
  const source = readFileSync(new URL('string-builder-append-single/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});

test('StringBuilder Single Append: source platform matches exact native values, identity and null receivers', () => {
  for (const row of native.rows) {
    const builder = builderPlatform('source');
    const {platform, reference, call} = builder;
    const value = int32BitsToSingle(Number.parseInt(row.bits, 16) | 0);
    try {
      const invoke = () => platform.invoke(builderContract('Append', ['float']), [row.nullReceiver ? null : reference, value]);
      if (row.fault) assert.throws(invoke, {name: row.fault});
      else {
        assert.deepEqual(invoke(), reference);
        assert.equal(platform.native(call('ToString')), row.output, row.bits);
        assert.equal(call('get_Length'), row.length, row.bits);
      }
    } finally { builder.stop(); }
  }
});

test('StringBuilder Single Append: independent CIL exact-bit locals preserve native output and fluent identity', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderSingleAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.bits + ': ' + result.fault?.stack);
      if (row.fault) assert.equal(result.fault.name, row.fault);
      else {
        const reference = vm.statics.get(0x04000001);
        assert.equal(Boolean(vm.statics.get(0x04000002)), row.same);
        assert.equal(vm.platform.native(vm.platform.invoke(builderContract('ToString'), [reference])), row.output, row.bits);
      }
    } finally { vm.stop(); }
  }
});

for (const engine of ['source', 'cil']) {
  test(`StringBuilder Single Append ${engine}: one rooted chunk survives observer GC and snapshot restoration`, () => {
    const builder = builderPlatform(engine);
    const {platform, vm, reference, call} = builder;
    const {heap} = platform;
    const value = int32BitsToSingle(0x4e6e6b28);
    const storage = platform.get(reference, '$data');
    const allocations = heap.stats.allocations;
    const version = platform.get(reference, '$version');
    let writes = 0;
    try {
      vm.onWrite = event => { if (event.kind === 'array') writes++; heap.collect(); };
      assert.deepEqual(call('Append', ['float'], [value]), reference);
      assert.equal(writes, 1);
      assert.equal(heap.stats.allocations - allocations, 1);
      assert.deepEqual(platform.get(reference, '$data'), storage);
      assert.equal(platform.get(reference, '$version'), version + 1);
      assert.equal(heap.pins.length, 0);
      vm.onWrite = null;
      const snapshot = heap.snapshot();
      call('Clear');
      heap.restore(snapshot);
      assert.equal(platform.native(call('ToString')), 'seed|1E+09');
    } finally { vm.onWrite = null; builder.stop(); }
  });

  test(`StringBuilder Single Append ${engine}: managed and host text budgets retain completed text`, () => {
    const builder = builderPlatform(engine);
    const {platform, reference, call} = builder;
    const {heap} = platform;
    const budget = heap.maxBytes;
    const row = rows.find(value => value.bits === '7f7fffff');
    const value = int32BitsToSingle(0x7f7fffff);
    try {
      heap.maxBytes = 1;
      assert.throws(() => call('Append', ['float'], [value]), {name: 'OutOfMemoryException'});
      heap.maxBytes = budget;
      assert.equal(platform.native(call('ToString')), 'seed|');
      call('set_Length', ['int'], [MAX - row.text.length]);
      call('Append', ['float'], [value]);
      assert.equal(call('get_Length'), MAX);
      const version = platform.get(reference, '$version');
      assert.throws(() => call('Append', ['float'], [float(0, 'r4')]), {name: 'OutOfMemoryException'});
      assert.equal(call('get_Length'), MAX);
      assert.equal(platform.get(reference, '$version'), version);
      assert.equal(heap.pins.length, 0);
    } finally { heap.maxBytes = budget; builder.stop(); }
  });

  test(`StringBuilder Single Append ${engine}: throwing observers retain released partial chunk behavior`, () => {
    const builder = builderPlatform(engine);
    const {platform, vm, call} = builder;
    const failure = new Error('Single append observer failed');
    try {
      vm.onWrite = event => { platform.heap.collect(); if (event.kind === 'array') throw failure; };
      assert.throws(() => call('Append', ['float'], [float(-0, 'r4')]), error => error === failure);
      vm.onWrite = null;
      assert.equal(platform.heap.pins.length, 0);
      assert.equal(platform.native(call('ToString')), 'seed|');
      call('Append', ['char'], [65]);
      assert.equal(platform.native(call('ToString')), 'seed|A');
    } finally { vm.onWrite = null; builder.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringBuilder Single Append ${pipeline}/${engine}: exact typed constants select the Single contract`, () => {
      const cases = singleSourceCases.map(([bits, literal], index) => `
        float value${index} = ${literal};
        var builder${index} = new StringBuilder("seed|");
        Console.WriteLine(builder${index}.Append(value${index}).ToString());`).join('\n');
      const program = compileToIL(`using System; using System.Text;
        ${cases}
        float fraction = 0.1f; float negativeZero = -0f;
        var builder = new StringBuilder();
        var returned = builder.Append(fraction).Append('|').Append(negativeZero).Append('|').Append(42).Append(true);
        Console.WriteLine(builder.ToString()); Console.WriteLine(object.ReferenceEquals(builder, returned));
        StringBuilder missing = null;
        try { missing.Append(fraction); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
      `, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const instructions = disassemble(program.image).flatMap(method => method.instructions);
      const builtins = instructions.filter(instruction => instruction.op === 'BUILTIN').map(instruction => instruction.a);
      assert(builtins.includes(frameworkBuiltin(builderContract('Append', ['float'])).id));
      const encoded = new Set(program.image.constants.filter(value => value?.scalar === 'float')
        .map(value => (singleToInt32Bits(decodeScalar(value)) >>> 0).toString(16).padStart(8, '0')));
      for (const [bits] of singleSourceCases) if (bits !== '7fc00000') assert(encoded.has(bits), 'Missing exact source bits ' + bits);
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        const expected = singleSourceCases.map(([bits]) => rows.find(row => row.bits === bits).output).join('\n');
        assert.equal(result.output, expected + '\n' + native.fluent.output + '\nTrue\nNullReferenceException\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringBuilder Single Append reserves 330 without shifting released comparer or scalar contracts', () => {
  assert.equal(builderContract('Append', ['float']).id, 524330);
  assert.equal(builderContract('Append', ['double']).id, 805);
  assert.equal(builderContract('Append', ['uint']).id, 524328);
  assert.equal(builderContract('Append', ['char']).id, 524309);
  assert.equal(findContracts('System.StringComparer', 'Equals').find(member => member.parameters.join(',') === 'string,string').id, 524329);
  assert.equal(native.fluent.same, true);
});
