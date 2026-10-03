import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const cases = [
  {
    name: 'semantic closures retain exact Decimal scale and UInt32 literals',
    source: 'using System; decimal Amount(){return 12345678901234567890.1200M;}' +
      'uint High(){return 4294967295U;} Console.WriteLine(Amount()); Console.WriteLine(High());' +
      'Console.WriteLine(decimal.GetBits(Amount())[3]);',
    output: '12345678901234567890.1200\n4294967295\n262144\n',
  },
  {
    name: 'semantic tuple increments preserve Decimal and UInt32 formatting',
    source: 'using System; var pair=(amount:1.25M,total:4294967295U);' +
      'pair.amount++; pair.total++; Console.WriteLine(pair);',
    output: '(2.25, 0)\n',
  },
  {
    name: 'legacy array reads use native-width checked indexes',
    pipeline: 'legacy',
    source: 'int[] values=new int[3L]; values[1UL]=7;values[(nuint)2]=9;' +
      'Console.WriteLine(values[(nint)1]);Console.WriteLine(values[2L]);Console.WriteLine(values[2UL]);',
    output: '7\n9\n9\n',
  },
  {
    name: 'legacy switch arms convert unsigned values before the Int64 join',
    pipeline: 'legacy',
    source: 'uint high=4294967295U;int choice=1;' +
      'long first=choice switch {1=>high,_=>-1L};Console.WriteLine(first);' +
      'choice=2;long second=choice switch {1=>high,_=>-1L};Console.WriteLine(second);',
    output: '4294967295\n-1\n',
  },
];

for (const item of cases) {
  for (const engine of ['source', 'reloaded', 'cil']) {
    test(`${item.name} (${engine})`, () => {
      const compiled = compileToIL(item.source, {pipeline: item.pipeline ?? 'bound'});
      assert(compiled.success, JSON.stringify(compiled.diagnostics));
      const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly)
        : new VirtualMachine(engine === 'reloaded' ? loadAssembly(compiled.assembly) : compiled.image);
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, item.output);
    });
  }
}
