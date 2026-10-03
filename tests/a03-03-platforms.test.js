import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { readPE, loadAssembly, PEMachine, CorFlags } from '@sharpforge/cil';

for (const [platform, machine, magic, flags] of [
  ['anycpu', PEMachine.I386, 0x10b, 1], ['x86', PEMachine.I386, 0x10b, 3],
  ['x64', PEMachine.AMD64, 0x20b, 1], ['arm64', PEMachine.ARM64, 0x20b, 1],
]) {
  test(`A03 ${platform} emits the platform header and round-trips canonical source loading`, () => {
    const compiled = compileToIL('Console.WriteLine(42);', { platform });
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const pe = readPE(compiled.assembly);
    assert.equal(pe.machine, machine);
    assert.equal(pe.magic, magic);
    assert.equal(pe.flags, flags);
    assert.equal(pe.isLibrary, false);
    assert.equal(loadAssembly(compiled.assembly).entryPoint, compiled.image.entryPoint);
    for (const Engine of [VirtualMachine, CilVirtualMachine]) {
      const vm = new Engine(compiled.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.message);
        assert.equal(result.output, '42\n');
      } finally { vm.stop(); }
    }
  });
}

test('A03 executable and library output characteristics, subsystem and preferred bitness', () => {
  const exe = compileToIL('Console.WriteLine(42);', { prefer32Bit: true, subsystem: 'windows' });
  assert(exe.success, JSON.stringify(exe.diagnostics));
  const pe = readPE(exe.assembly);
  assert.equal(pe.characteristics & 0x2000, 0);
  assert.equal(pe.subsystem, 2);
  assert.equal(pe.flags, CorFlags.ILOnly | CorFlags.Requires32Bit | CorFlags.Prefers32Bit);
  const library = compileToIL('public class Library {}', { outputKind: 'library' });
  assert(library.success, JSON.stringify(library.diagnostics));
  assert.equal(readPE(library.assembly).characteristics & 0x2000, 0x2000);
  assert.equal(readPE(library.assembly).entryPoint, 0);
  for (const options of [{ platform: 'mips' }, { platform: 'x64', prefer32Bit: true }, { subsystem: 'unknown' }]) {
    const rejected = compileToIL('Console.WriteLine(1);', options);
    assert.equal(rejected.success, false);
    assert(rejected.diagnostics.some(diagnostic => /platform|Prefer32Bit|subsystem/.test(diagnostic.message)));
  }
});
