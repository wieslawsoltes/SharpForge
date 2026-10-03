import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {number} from '@sharpforge/bytecode';
import {managedFixture} from './managed-fixtures.js';

function run(bytes, options) {
  const vm = new CilVirtualMachine(bytes, options), result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  return {vm, result};
}

for (const nativeIntBits of [32, 64]) {
  const options = {nativeIntBits}, expected = nativeIntBits === 64 ? 4294967297n : 1n;

  test(`CIL native${nativeIntBits}: indirect, static, argument and array storage share the declared width`, () => {
    const bytes = managedFixture({fields: [{name: 'Value', type: 'nint'}], methods: [
      {name: 'Main', result: 'long', locals: ['nint', 'nint[]'], body(w, c) {
        w.op('ldloca.s', 0).op('ldc.i8', 4294967297n).op('conv.i').op('stind.i');
        w.op('ldloca.s', 0).op('ldind.i').op('call', c.methods.Identity).op('stsfld', c.fields.Value);
        w.op('ldc.i4.1').op('conv.i').op('newarr', c.resolve('System.IntPtr')).op('stloc.1');
        w.op('ldloc.1').op('ldc.i4.0').op('conv.i').op('ldsfld', c.fields.Value).op('stelem.i');
        w.op('ldloc.1').op('ldc.i4.0').op('conv.i').op('ldelema', c.resolve('System.IntPtr')).op('ldind.i');
        w.op('conv.i8').op('ret');
      }},
      {name: 'Identity', parameters: ['nint'], result: 'nint', body: w => w.op('ldarg.0').op('ret')}
    ]});
    const {result, vm} = run(bytes, options);
    assert.equal(result.returnValue, expected);
    const table = vm.typeSystem.table('nint');
    assert.equal(table, vm.typeSystem.table('System.IntPtr'));
    assert.equal(table.valueSize, nativeIntBits / 8);
    assert.equal(vm.typeSystem.table('nint[]').elementType, table);
  });

  test(`CIL native${nativeIntBits}: IntPtr.Size, UIntPtr.Size, sizeof and boxed unsigned display`, () => {
    const bytes = managedFixture({methods: [{name: 'Main', result: 'void', body(w, c) {
      const writeInt = c.member('System.Console', 'WriteLine', 'void', ['int']);
      for (const type of ['System.IntPtr', 'System.UIntPtr']) {
        w.op('call', c.member(type, 'get_Size', 'int')).op('call', writeInt);
        w.op('sizeof', c.resolve(type)).op('call', writeInt);
      }
      w.op('ldc.i8', -1n).op('conv.u').op('box', c.resolve('System.UIntPtr'));
      w.op('call', c.member('System.Console', 'WriteLine', 'void', ['object'])).op('ret');
    }}]});
    const {result} = run(bytes, options);
    assert.equal(result.output, `${nativeIntBits / 8}\n`.repeat(4) + ((1n << BigInt(nativeIntBits)) - 1n) + '\n');
  });

  test(`CIL native${nativeIntBits}: zero branches, native shift counts and ldlen keep stack categories`, () => {
    const bytes = managedFixture({methods: [{name: 'Main', result: 'long', locals: ['nint'], body(w, c) {
      w.op('ldloc.0').op('brtrue', 'bad');
      w.op('ldc.i4.1').op('newarr', c.resolve('System.IntPtr')).op('ldlen');
      w.op('ldc.i8', 1n).op('ldc.i4.1').op('conv.i').op('shl').op('conv.i').op('add');
      w.op('conv.i8').op('ret');
      w.mark('bad').op('ldc.i8', -1n).op('ret');
    }}]});
    assert.equal(run(bytes, options).result.returnValue, 3n);
  });

  test(`CIL native${nativeIntBits}: host arguments and results retain exact signed/unsigned values`, () => {
    for (const type of ['nint', 'nuint']) {
      const unsigned = type === 'nuint', value = unsigned ? (1n << BigInt(nativeIntBits)) - 1n : -(1n << BigInt(nativeIntBits - 1));
      const bytes = managedFixture({methods: [{name: 'Main', parameters: [type], result: type, body: w => w.op('ldarg.0').op('ret')}]});
      const {result, vm} = run(bytes, {...options, arguments: [String(value)]});
      assert.equal(result.returnValue, nativeIntBits === 64 ? value : Number(value));
      assert.equal(vm.resultDisplay(), String(value));
      assert.equal(vm.returnValue.nativeInt, nativeIntBits);
      assert.throws(() => new CilVirtualMachine(bytes, {...options, arguments: [unsigned ? -1 : String(value - 1n)]}), /out of range/);
      assert.throws(() => new CilVirtualMachine(bytes, {...options, arguments: [Number.MAX_SAFE_INTEGER + 1]}), /exact integer/);
    }
    const bytes = managedFixture({methods: [{name: 'Main', parameters: ['nint[]'], result: 'long', body: w =>
      w.op('ldarg.0').op('ldc.i4.0').op('ldelem.i').op('conv.i8').op('ret')}]});
    assert.equal(run(bytes, {...options, arguments: [[String(expected)]]}).result.returnValue, expected);
  });

  test(`CIL native${nativeIntBits}: snapshots retain immutable carriers and ABI without new schema fields`, () => {
    const bytes = managedFixture({methods: [{name: 'Main', result: 'nint', locals: ['nint'], body: w =>
      w.op('ldc.i8', 4294967297n).op('conv.i').op('stloc.0').op('ldloc.0').op('ldc.i4.1').op('add').op('ret')}]});
    const vm = new CilVirtualMachine(bytes, options);
    vm.runSlice({instructionBudget: 3, timeBudgetMs: 1000});
    const carrier = vm.top.locals[0], saved = vm.snapshot();
    assert.equal(number(carrier), nativeIntBits === 64 ? expected : Number(expected));
    assert(Object.isFrozen(carrier));
    assert.throws(() => { vm.options.nativeIntBits = nativeIntBits === 64 ? 32 : 64; }, TypeError);
    const result = vm.run();
    vm.restore(saved);
    assert.equal(vm.top.locals[0], carrier);
    assert.equal(vm.run().returnValue, result.returnValue);
    vm.restore(saved);
    vm.stop();
    assert.equal(vm.state, 'terminated');
    assert.equal(vm.frames.length, 0);
  });

  test(`CIL native${nativeIntBits}: mixed unsigned arithmetic and branch extension follow opcode semantics`, () => {
    const bytes = managedFixture({methods: [{name: 'Main', result: 'long', locals: ['int'], body(w) {
      w.op('ldc.i4.m1').op('conv.i').op('ldc.i4.m1').op('ceq').op('stloc.0');
      w.op('ldc.i4.m1').op('conv.i').op('ldc.i4.m1').op('bne.un', 'different');
      w.op('ldc.i4.0').op('conv.i').op('ldc.i4.m1').op('add.ovf.un').op('conv.u8').op('ret');
      w.mark('different').op('ldc.i4.0').op('conv.i').op('ldc.i4.m1').op('add.ovf.un');
      w.op('ldloc.0').op('add').op('conv.u8').op('ret');
    }}]});
    assert.equal(run(bytes, options).result.returnValue, nativeIntBits === 64 ? 4294967296n : 4294967295n);
  });

  test(`CIL native${nativeIntBits}: implicit native returns and managed box mutation preserve width`, () => {
    const bytes = managedFixture({methods: [
      {name: 'Main', result: 'nint', body(w, c) {
        w.op('call', c.methods.ReturnNative).op('box', c.resolve('System.IntPtr')).op('dup');
        w.op('unbox', c.resolve('System.IntPtr')).op('ldc.i8', 4294967297n).op('conv.i').op('stind.i');
        w.op('unbox.any', c.resolve('System.IntPtr')).op('ret');
      }},
      {name: 'ReturnNative', result: 'nint', body: w => w.op('ldc.i4.m1').op('ret')}
    ]});
    assert.equal(run(bytes, options).result.returnValue, nativeIntBits === 64 ? expected : Number(expected));
  });

  test(`CIL native${nativeIntBits}: checked overflow reaches managed execution faults`, () => {
    const maximum = (1n << BigInt(nativeIntBits - 1)) - 1n;
    const bytes = managedFixture({methods: [{name: 'Main', result: 'nint', body: w =>
      w.op('ldc.i8', maximum).op('conv.i').op('ldc.i4.1').op('add.ovf').op('ret')}]});
    const result = new CilVirtualMachine(bytes, options).run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'OverflowException');
  });
}

test('CIL validates ABI width before executing or creating native type tables', () => {
  assert.throws(() => new CilVirtualMachine(managedFixture(), {nativeIntBits: 16}), /nativeIntBits must be 32 or 64/);
});
