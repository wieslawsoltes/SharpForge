import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL, compile} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {memorySourceCases} from './a05-memory-source-fixtures.js';
import {sourceScalarCases} from './a05-01-fixtures.js';

const cases = [...sourceScalarCases, ...memorySourceCases];
for (const pipeline of ['bound', 'legacy']) {
  for (const item of cases) test(`modular ${pipeline}: ${item.name}`, () => {
    const compiled = compileToIL(item.source, {pipeline});
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    for (const vm of [new VirtualMachine(compiled.image), new VirtualMachine(loadAssembly(compiled.assembly)),
      new CilVirtualMachine(compiled.assembly)]) {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, item.output);
    }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  test(`modular ${pipeline}: contextual scalar conversions preserve numeric modes`, () => {
    const source = 'uint x=4294967295U;long y=9223372036854775807L;byte small=255;' +
      'x+=1;small+=1;Console.WriteLine(x);Console.WriteLine(small);Console.WriteLine(y>>>63);' +
      'decimal money=1.25M;Console.WriteLine(money+2);float f=true?0.1F:2;Console.WriteLine(f);';
    const compiled = compileToIL(source, {pipeline});
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    assert.equal(new VirtualMachine(compiled.image).run().output, '0\n0\n0\n3.25\n0.1\n');
  });
  test(`modular ${pipeline}: bound scalar diagnostics`, () => {
    for (const source of ['float f=1F;Console.WriteLine(f>>>1);', 'Span<int> s=stackalloc int[1];object o=s;',
      'int x=1;byte b=x;', 'decimal x=1M;double y=2;Console.WriteLine(x+y);']) {
      assert.equal(compile(source, {pipeline}).success, false, source);
    }
  });
}
