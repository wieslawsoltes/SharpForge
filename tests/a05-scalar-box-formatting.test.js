import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op, Binary, BuiltinMap, frameworkBuiltin, decodeScalar} from '@sharpforge/bytecode';
import {findContracts} from '@sharpforge/framework';
import {emitAssembly, loadAssembly} from '@sharpforge/cil';
import {ManagedHeap, VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {formatCilValue} from '../packages/runtime/src/value-formatting.js';
import {cilValue} from '../packages/runtime/src/execution/cil-values.js';

const cases = [
  ['uint', 'System.UInt32', '4294967295', '4294967295'],
  ['char', 'System.Char', '66', 'B'],
  ['float', 'System.Single', '0.1', '0.1'],
  ['float', 'System.Single', '-0', '-0'],
  ['double', 'System.Double', '0.1', '0.1'],
  ['ulong', 'System.UInt64', '18446744073709551615', '18446744073709551615'],
  ['nint', 'System.IntPtr', '-4294967296', '-4294967296'],
  ['nuint', 'System.UIntPtr', '18446744073709551615', '18446744073709551615'],
  ['decimal', 'System.Decimal', [1230, 0, 0, 2 << 16], '12.30'],
];

test('CIL box formatting retains both source aliases and System type names', () => {
  const vm = {heap: new ManagedHeap(), options: {nativeIntBits: 64}};
  vm.value = value => cilValue(vm, value);
  vm.format = (value, type) => formatCilValue(vm, value, type);
  for (const [type, systemName, value, expected] of cases) {
    const scalar = decodeScalar({scalar: type, value}, vm.options);
    for (const name of [type, systemName]) {
      const reference = vm.heap.allocate('box', name, [scalar]);
      assert.equal(vm.format(reference), expected, name);
      assert.equal(vm.format(reference, 'object'), expected, name);
    }
  }
  for (const name of ['bool', 'System.Boolean']) {
    assert.equal(vm.format(vm.heap.allocate('box', name, [0])), 'False');
    assert.equal(vm.format(vm.heap.allocate('box', name, [1])), 'True');
  }
});

function formattingImage() {
  const constants = [], instructions = [];
  const box = frameworkBuiltin(findContracts('SharpForge.Runtime.Formatting', 'BoxValue', true)[0]).id;
  const writeLine = BuiltinMap.get('Console.WriteLine').id;
  const push = value => {
    instructions.push(Op.CONST, constants.length, 0);
    constants.push(value);
  };
  const boxed = (type, value) => {
    push({scalar: type, value});
    push(type);
    instructions.push(Op.BUILTIN, box, 2);
  };
  for (const [type, , value] of cases) {
    boxed(type, value);
    instructions.push(Op.BUILTIN, writeLine, 1, Op.POP, 0, 0);
  }
  push('value=');
  boxed('ulong', '18446744073709551615');
  instructions.push(Op.BINARY, Binary['+'], 2, Op.BUILTIN, writeLine, 1, Op.RET, 0, 0);
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
      code: Int32Array.from(instructions),
    }],
  };
}

test('compiler BoxValue bridge preserves declared scalar text through Console and object concatenation', () => {
  const image = formattingImage(), assembly = emitAssembly(image), options = {nativeIntBits: 64};
  const expected = cases.map(([, , , text]) => text).join('\n') + '\nvalue=18446744073709551615\n';
  for (const vm of [new VirtualMachine(image, options), new CilVirtualMachine(assembly, options),
    new VirtualMachine(loadAssembly(assembly), options)]) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, expected);
  }
});
