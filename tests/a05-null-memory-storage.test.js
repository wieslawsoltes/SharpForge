import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {nativeInteger} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const compiled = compileToIL('class Program { static void Main() {} }');
assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
for (const bits of [32, 64]) {
  for (const [engine, create] of [
    ['source', () => new VirtualMachine(compiled.image, {nativeIntBits: bits})],
    ['cil', () => new CilVirtualMachine(compiled.assembly, {nativeIntBits: bits})]
  ]) {
    test(`${engine}: native zero clears scoped pointer storage only at its declared width ${bits}`, () => {
      const vm = create();
      for (const type of ['int&', 'int*']) {
        assert.equal(vm.storage(nativeInteger(0, bits), type), null);
        for (const invalid of [nativeInteger(1, bits), nativeInteger(0, bits === 32 ? 64 : 32),
          {nativeInt: bits, value: bits === 32 ? 0 : 0n}]) {
          assert.throws(() => vm.storage(invalid, type), {name: 'InvalidProgramException'});
        }
      }
    });
  }
}
