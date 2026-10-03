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

// Local functions require semantic lowering; these prevent scalar/memory support from silently depending on the legacy adapter.
const semanticCases = [
  {
    name: 'semantic Decimal constructors compose with instance formatting and out arguments',
    source: 'using System; decimal Read(){decimal initial=new decimal(12345,0,0,false,2);' +
      'Console.WriteLine(initial.ToString());decimal parsed;' +
      'Console.WriteLine(decimal.TryParse("12.30",out parsed));return parsed;}' +
      'decimal result=Read();Console.WriteLine(result);Console.WriteLine(decimal.GetBits(result)[3]);',
    output: '123.45\nTrue\n12.30\n131072\n',
  },
  {
    name: 'semantic scalar closures and typed framework overloads',
    source: 'using System; long seed=9223372036854775806L; long Next(){return ++seed;}' +
      'decimal Round(decimal x){return Math.Round(x,2);} Console.WriteLine(Next());' +
      'Console.WriteLine(Round(1.235M)); Console.WriteLine(BitConverter.DoubleToInt64Bits(-0.0));',
    output: '9223372036854775807\n1.24\n-9223372036854775808\n',
  },
  {
    name: 'semantic rectangular arrays and stack allocated spans',
    source: 'using System; int Sum(){int[,] a=new int[,]{{1,2},{3,4}};' +
      'Span<int> s=stackalloc int[]{a[0,1],a[1,0]};ReadOnlySpan<int> r=s;' +
      'return r.Slice(1)[0]+a.GetLength(0);} Console.WriteLine(Sum());',
    output: '5\n',
  },
  {
    name: 'semantic checked conversions and exact unsigned constants',
    source: 'using System; byte Narrow(int x){return checked((byte)x);}' +
      'ulong High(){return ulong.MaxValue>>>1;} Console.WriteLine(Narrow(255));Console.WriteLine(High());',
    output: '255\n9223372036854775807\n',
  },
];
for (const item of semanticCases) test(item.name, () => {
  const compiled = compileToIL(item.source);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  for (const vm of [new VirtualMachine(compiled.image), new VirtualMachine(loadAssembly(compiled.assembly)),
    new CilVirtualMachine(compiled.assembly)]) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, item.output);
  }
});

test('semantic numeric profiles retain tuple text and numeric increments', () => {
  const source = 'using System; var pair=(amount:1.25M,total:4294967295U);' +
    'pair.amount++; pair.total++; Console.WriteLine(pair);';
  const compiled = compileToIL(source);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  assert.equal(new VirtualMachine(compiled.image).run().output, '(2.25, 0)\n');
});
