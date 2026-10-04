import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {BuiltinMap} from '@sharpforge/bytecode';
import {decodeNumericBuiltin} from '../packages/cil/src/numeric-builtin-mapping.js';

function run(body, expected, options = {}) {
  const compiled = compileToIL(`using System; class Program { static void Main() { ${body} } }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const [engine, create] of [
    ['source', () => new VirtualMachine(compiled.image, options)],
    ['reloaded source', () => new VirtualMachine(loadAssembly(compiled.assembly), options)],
    ['direct CIL', () => new CilVirtualMachine(compiled.assembly, options)]
  ]) {
    const result = create().run();
    assert.equal(result.state, 'terminated', engine + ': ' + result.fault?.stack);
    assert.equal(result.output, expected, engine);
  }
  return compiled;
}

test('A05 source bit reinterpretation preserves Single rounding and negative zero in every route', () => {
  run(`float single = 16777216f;
    Console.WriteLine(BitConverter.SingleToInt32Bits(single + 1f));
    Console.WriteLine(BitConverter.DoubleToInt64Bits(-0.0));
    Console.WriteLine(BitConverter.SingleToInt32Bits(BitConverter.Int32BitsToSingle(int.MinValue)));
    Console.WriteLine(BitConverter.DoubleToInt64Bits(BitConverter.Int64BitsToDouble(long.MinValue)));
    Console.WriteLine(BitConverter.Int32BitsToSingle(1065353216));
    Console.WriteLine(BitConverter.Int64BitsToDouble(4607182418800017408L));`,
  '1266679808\n-9223372036854775808\n-2147483648\n-9223372036854775808\n1\n1\n');
});

test('A05 source IEEE remainder uses ties to even and retains dividend zero sign', () => {
  run(`Console.WriteLine(Math.IEEERemainder(3.0, 2.0));
    Console.WriteLine(Math.IEEERemainder(5.0, 2.0));
    Console.WriteLine(Math.IEEERemainder(-3.0, 2.0));
    Console.WriteLine(BitConverter.DoubleToInt64Bits(Math.IEEERemainder(-4.0, 2.0)));
    Console.WriteLine(Math.IEEERemainder(double.PositiveInfinity, 2.0));`,
  '-1\n1\n1\n-9223372036854775808\nNaN\n');
});

for (const nativeIntBits of [32, 64]) test(`A05 native Size follows the selected ${nativeIntBits}-bit VM ABI`, () => {
  run(`Console.WriteLine(IntPtr.Size); Console.WriteLine(UIntPtr.Size);`,
    `${nativeIntBits / 8}\n${nativeIntBits / 8}\n`, {nativeIntBits});
});

test('A05 numeric source mapping rejects altered signatures and instruction markers', () => {
  const builtin = BuiltinMap.get('BitConverter.SingleToInt32Bits');
  const target = {owner: 'System.BitConverter', name: 'SingleToInt32Bits', token: 0x0a000001,
    sig: {kind: 'method', isStatic: true, genericArity: 0, callingConvention: 0, parameters: ['float'], returnType: 'int'}};
  const span = [{name: 'call', operand: target.token}, {name: 'nop'}];
  assert.equal(decodeNumericBuiltin(target, span), builtin);
  for (const change of [{isStatic: false}, {parameters: ['double']}, {returnType: 'long'}, {parameters: null},
    {genericArity: 1}, {callingConvention: 5}, {explicitThis: true}, {sentinel: 0}]) {
    assert.equal(decodeNumericBuiltin({...target, sig: {...target.sig, ...change}}, span), null);
  }
  assert.equal(decodeNumericBuiltin({...target, owner: 'User.BitConverter'}, span), null);
  assert.equal(decodeNumericBuiltin(target, span.slice(0, 1)), null);
  assert.equal(decodeNumericBuiltin(target, [{name: 'call', operand: target.token + 1}, span[1]]), null);
  assert.equal(decodeNumericBuiltin(target, [span[0], ...span]), null);
});

test('A05 numeric source APIs retain ordinary overload and readonly property diagnostics', () => {
  for (const body of ['BitConverter.Int64BitsToDouble(1.5);', 'IntPtr.Size = 8;',
    'Math.IEEERemainder(1.0, 2.0, 3.0);']) {
    const result = compileToIL('using System; class Program { static void Main() { ' + body + ' } }');
    assert.equal(result.success, false, body);
    assert(result.diagnostics.some(item => item.severity === 'error'), body);
  }
});
