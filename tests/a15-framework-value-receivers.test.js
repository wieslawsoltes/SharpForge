import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly, formatILDocument, assembleILDocument} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = `using System;
TimeSpan value = TimeSpan.FromMilliseconds(1500.0);
Console.WriteLine(value.TotalSeconds);
TimeSpan? present = value;
Console.WriteLine(present.Value.TotalSeconds);
Console.WriteLine(present.GetValueOrDefault().TotalSeconds);
TimeSpan? absent = null;
Console.WriteLine(absent.GetValueOrDefault().TotalSeconds);
object boxed = present; TimeSpan? copied = (TimeSpan?)boxed;
GC.Collect(); Console.WriteLine(copied.Value.TotalSeconds);
`;
let compiled;
function program() {
  if (!compiled) {
    compiled = compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  }
  return compiled;
}

for (const [engine, create] of Object.entries({
  source: built => new VirtualMachine(built.image),
  canonical: built => new VirtualMachine(loadAssembly(built.assembly)),
  cil: built => new CilVirtualMachine(built.assembly),
  reassembled: built => new CilVirtualMachine(assembleILDocument(formatILDocument(built.assembly)).bytes)
})) {
  test(`A15 ${engine}: computed framework value getters accept addressable locals and nullable results`, () => {
    const vm = create(program());
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '1.5\n1.5\n1.5\n0\n1.5\n');
      assert.equal(vm.heap.pins.length, 0);
    } finally { vm.stop(); }
  });
}
