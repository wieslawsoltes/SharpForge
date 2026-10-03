import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {nativeInteger, nativeBinary, nativeSize} from '@sharpforge/bytecode';
import {controlFixture} from './support/control-fixture.js';

for (const nativeIntBits of [32, 64]) {
  const options = {nativeIntBits};
  test(`T01.4 ABI${nativeIntBits} properties and mixed native arithmetic agree in all engines`, () => {
    const source = 'Console.WriteLine(System.IntPtr.Size);Console.WriteLine(System.UIntPtr.Size);' +
      'nint value=(nint)7;int offset=-2;Console.WriteLine((long)(value+offset));';
    const compiled = compileToIL(source);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const engines = [new VirtualMachine(compiled.image, options),
      new VirtualMachine(loadAssembly(compiled.assembly), options), new CilVirtualMachine(compiled.assembly, options)];
    for (const vm of engines) {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, `${nativeIntBits / 8}\n${nativeIntBits / 8}\n5\n`);
    }
    assert.equal(nativeSize(options), nativeIntBits / 8);
    assert.deepEqual(nativeBinary('add', 7, -2, options), nativeInteger(5, nativeIntBits));
  });

  test(`T01.4 ABI${nativeIntBits} indirect and array native stores preserve full width`, () => {
    const bytes = controlFixture([{name: 'Program', methods: [{name: 'Main', result: 'long',
      locals: ['nint', 'nint[]'], body(writer, context) {
        writer.op('ldloca.s', 0).op('ldc.i8', 4294967297n).op('conv.i').op('stind.i');
        writer.integer(1).op('newarr', context.resolve('System.IntPtr')).op('stloc.1');
        writer.op('ldloc.1').integer(0).op('ldloca.s', 0).op('ldind.i').op('stelem.i');
        writer.op('ldloc.1').integer(0).op('ldelem.i').op('conv.i8').op('ret');
      }}]}]);
    const result = new CilVirtualMachine(bytes, options).run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, nativeIntBits === 64 ? 4294967297n : 1n);
  });
}
