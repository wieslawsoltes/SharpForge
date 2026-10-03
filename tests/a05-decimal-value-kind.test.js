import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {decimalParse, decimalBits, decimalFormat, decimalBinary} from '../packages/runtime/src/execution/decimal.js';

test('T01.7 Decimal value seam preserves the independent scale and sign bits', () => {
  const value = decimalParse('-1.10');
  assert.equal(decimalFormat(value), '-1.10');
  assert.deepEqual(decimalBits(value), [110, 0, 0, -2147352576]);
  assert.throws(() => decimalBinary('+', decimalParse('79228162514264337593543950335'), decimalParse('1')),
    {name: 'OverflowException'});
});

test('T01.7 both engines copy and box Decimal96 without binary floating approximation', () => {
  const source = 'decimal a=0.1M;decimal b=0.2M;Console.WriteLine(a+b);Console.WriteLine(1M/3M);' +
    'decimal value=1.10M;object boxed=value;value=2M;GC.Collect();Console.WriteLine(boxed);' +
    'decimal max=decimal.MaxValue;try{Console.WriteLine(max+1M);}' +
    'catch(Exception error){Console.WriteLine(error.GetType().Name);}';
  const compiled = compileToIL(source);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  for (const vm of [new VirtualMachine(compiled.image), new VirtualMachine(loadAssembly(compiled.assembly)),
    new CilVirtualMachine(compiled.assembly)]) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, '0.3\n0.3333333333333333333333333333\n1.10\nOverflowException\n');
  }
});
