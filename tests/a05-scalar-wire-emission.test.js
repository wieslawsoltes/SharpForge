import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMAT_VERSION, Op, Binary, BuiltinMap, NumericType, numericMode, verifyImage,
} from '@sharpforge/bytecode';
import {emitAssembly, loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

function scalarImage(constants, instructions) {
  return {
    formatVersion: FORMAT_VERSION,
    entryPoint: 0,
    sources: [],
    constants,
    types: [],
    sequencePoints: [],
    statics: [],
    methods: [{
      id: 0,
      owner: null,
      name: 'Main',
      qualifiedName: 'Program.Main',
      parameters: [],
      returnType: 'void',
      isStatic: true,
      locals: [],
      handlers: [],
      code: Int32Array.from(instructions.flat()),
    }],
  };
}

const output = [Op.BUILTIN, BuiltinMap.get('Console.WriteLine').id, 1];
const finish = [Op.RET, 0, 0];

function engines(image, nativeIntBits) {
  assert.deepEqual(verifyImage(image), []);
  const assembly = emitAssembly(image);
  const reloaded = loadAssembly(assembly);
  assert.deepEqual(verifyImage(reloaded), []);
  const options = {nativeIntBits};
  return [new VirtualMachine(image, options), new CilVirtualMachine(assembly, options), new VirtualMachine(reloaded, options)];
}

function assertOutcome(image, nativeIntBits, fault = null) {
  for (const vm of engines(image, nativeIntBits)) {
    const result = vm.run();
    assert.equal(result.state, fault ? 'faulted' : 'terminated', result.fault?.stack);
    if (fault) assert.equal(result.fault.name, fault);
    else assert.equal(result.output, 'True\n');
  }
}

const aliases = [
  ['System.Int64', 'long', '9223372036854775807'],
  ['System.UInt64', 'ulong', '18446744073709551615'],
  ['System.Single', 'float', '1.25'],
  ['System.Double', 'double', '-0'],
  ['System.Decimal', 'decimal', [12345, 0, 0, 2 << 16]],
  ['System.IntPtr', 'nint', '-2147483648'],
  ['System.UIntPtr', 'nuint', '4294967295'],
];

for (const [alias, type, value] of aliases) {
  test(`scalar wire alias ${alias} emits and joins its canonical type across engines`, () => {
    for (const condition of [false, true]) {
      const image = scalarImage([condition, {scalar: alias, value}, {scalar: type, value}], [
        [Op.CONST, 0, 0],
        [Op.JFALSE, 4, 0],
        [Op.CONST, 1, 0],
        [Op.JUMP, 5, 0],
        [Op.CONST, 2, 0],
        [Op.CONST, 2, 0],
        [Op.BINARY, Binary['=='], numericMode(type)],
        output,
        finish,
      ]);
      for (const width of [32, 64]) assertOutcome(image, width);
    }
  });
}

function nativeLiteral(type, value) {
  return scalarImage([{scalar: type, value}], [
    [Op.CONST, 0, 0],
    [Op.CONST, 0, 0],
    [Op.BINARY, Binary['=='], numericMode(type)],
    output,
    finish,
  ]);
}

for (const [type, values] of [
  ['nint', ['-2147483648', '2147483647']],
  ['nuint', ['0', '4294967295']],
]) {
  test(`${type} wire literals at native32 boundaries remain valid under both ABIs`, () => {
    for (const value of values) {
      for (const width of [32, 64]) assertOutcome(nativeLiteral(type, value), width);
    }
  });
}

for (const [type, values] of [
  ['nint', ['-9223372036854775808', '-2147483649', '2147483648', '4294967296', '9223372036854775807']],
  ['nuint', ['4294967296', '18446744073709551615']],
]) {
  test(`${type} wire literals outside native32 range fault instead of wrapping`, () => {
    for (const value of values) {
      const image = nativeLiteral(type, value);
      assertOutcome(image, 32, 'OverflowException');
      assertOutcome(image, 64);
    }
  });
}

for (const type of ['nint', 'nuint']) {
  test(`ordinary ${type} casts retain their checked and unchecked policies`, () => {
    for (const checked of [false, true]) {
      const image = scalarImage([{scalar: 'long', value: '4294967296'}, {scalar: type, value: '0'}], [
        [Op.CONST, 0, 0],
        [Op.CONVERT, NumericType[type], numericMode('long', checked)],
        [Op.CONST, 1, 0],
        [Op.BINARY, Binary['=='], numericMode(type)],
        output,
        finish,
      ]);
      assertOutcome(image, 32, checked ? 'OverflowException' : null);
    }
  });
}
