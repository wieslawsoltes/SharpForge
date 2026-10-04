import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {evaluateConstant} from '../packages/compiler/src/constants.js';
import {conversionMatrixSource} from './support/numeric-conversion-matrix.js';

test('the legacy constant adapter defers imprecise integer tokens without changing Int32 minimum folding', () => {
  const literal = value => ({kind: 'Literal', type: 'int', value});
  assert.equal(evaluateConstant({kind: 'Unary', operator: '-', operand: literal(2 ** 63)}), null);
  assert.equal(evaluateConstant({kind: 'Cast', type: 'int', expression: literal(2 ** 64)}), null);
  assert.deepEqual(evaluateConstant({kind: 'Unary', operator: '-', operand: literal(2 ** 31)}), {
    type: 'int', value: -2147483648,
  });
});

test('exact signed minimum and unsigned maximum literals execute through source, reload and CIL', () => {
  // The pinned Roslyn corpus accepts this unary-minus spelling as Int64; its
  // positive token alone is UInt64, so the legacy Int32 AST cannot fold it.
  const source = `using System; class Program { static void Main() {
    long minimum = -9223372036854775808L;
    ulong maximum = 18446744073709551615UL;
    nint pointerWidth = (nint)(-9223372036854775808L);
    Console.WriteLine(minimum); Console.WriteLine(maximum); Console.WriteLine((long)pointerWidth);
  } }`;
  const compiled = compileToIL(source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const expected = '-9223372036854775808\n18446744073709551615\n-9223372036854775808\n';
  for (const vm of [new VirtualMachine(compiled.image, {nativeIntBits: 64}),
    new VirtualMachine(loadAssembly(compiled.assembly), {nativeIntBits: 64}),
    new CilVirtualMachine(compiled.assembly, {nativeIntBits: 64})]) {
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, expected);
    } finally { vm.stop(); }
  }
});

test('an out-of-range implicit signed assignment reports a source diagnostic rather than throwing', () => {
  let result;
  assert.doesNotThrow(() => {
    result = compileToIL('using System; class Program { static void Main(){ long value=9223372036854775808L; } }');
  });
  assert.equal(result.success, false);
  assert(result.diagnostics.some(diagnostic => diagnostic.code === 'CS0266'));
});

test('native conversion fixture operands keep unary minus inside the contextual-type cast', () => {
  const source = conversionMatrixSource({source: 'native', input: '-9223372036854775808', target: 'long',
    opcode: 'conv.i8', nativeIntBits: 64});
  assert.match(source, /nint value=\(nint\)\(-9223372036854775808L\)/);
  const compiled = compileToIL('using System; ' + source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
});
