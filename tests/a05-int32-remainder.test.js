import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector, loadAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {binary, float} from '../packages/runtime/src/execution/numeric-ops.js';
import {binary as sourceBinary} from '../packages/runtime/src/execution/source-ops.js';
import {managedFixture} from './managed-fixtures.js';

const referencePath = new URL('./fixtures/a05/int32-remainder/native-boundaries.json', import.meta.url);
const reference = JSON.parse(readFileSync(referencePath, 'utf8'));
const sourceVm = {value: value => value};

function observe(operation) {
  try { return String(operation()); }
  catch (error) { return '!' + error.name; }
}

test('Int32 division/remainder helpers preserve the saved native endpoint results', () => {
  for (const item of reference.cases) {
    const label = `${item.opcode} ${item.left}, ${item.right}; native line ${item.sourceLine}`;
    assert.equal(observe(() => binary(item.opcode, item.left, item.right)), item.expected, label);
    if (item.opcode === 'div' || item.opcode === 'rem') {
      const operator = item.opcode === 'div' ? '/' : '%';
      assert.equal(observe(() => sourceBinary(sourceVm, operator, item.left, item.right, 1)), item.expected, label);
    }
  }
});

test('independently assembled Int32 rem/div methods match the existing CLR reference rows', () => {
  const assemblies = new Map();
  for (const item of reference.cases) {
    if (!assemblies.has(item.opcode)) {
      assemblies.set(item.opcode, managedFixture({methods: [{name: 'Main', result: 'int', parameters: ['int', 'int'],
        body: writer => writer.op('ldarg.0').op('ldarg.1').op(item.opcode).op('ret')}]}));
    }
    const vm = new CilVirtualMachine(assemblies.get(item.opcode), {arguments: [item.left, item.right]});
    try {
      const result = vm.run();
      const actual = result.fault ? '!' + result.fault.name : String(result.returnValue);
      assert.equal(actual, item.expected, `${item.opcode}; native line ${item.sourceLine}`);
      assert.equal(result.state, item.expected.startsWith('!') ? 'faulted' : 'terminated');
    } finally { vm.stop(); }
  }
});

test('Int32 rem keeps neighboring values, floating signed zero and injected faults distinct', () => {
  for (const [left, right, expected] of [
    [-2147483647, -1, 0], [-2147483648, -2, 0], [-17, 3, -2], [17, -3, 2]
  ]) {
    assert.equal(binary('rem', left, right), expected);
    assert.equal(sourceBinary(sourceVm, '%', left, right, 1), expected);
  }
  const floating = binary('rem', float(-2147483648), float(-1));
  assert.equal(floating.float, 'r8');
  assert(Object.is(floating.value, -0));
  assert(Object.is(sourceBinary(sourceVm, '%', -2147483648, -1, 0), -0));
  const injected = new Error('injected managed fault');
  assert.throws(() => binary('rem', -2147483648, -1, {fault(name, message) {
    assert.equal(name, 'OverflowException');
    assert.equal(message, 'Integer division overflow');
    return injected;
  }}), error => error === injected);
});

const engines = {
  source: compiled => new VirtualMachine(compiled.image),
  reload: compiled => new VirtualMachine(loadAssembly(compiled.assembly)),
  cil: compiled => new CilVirtualMachine(compiled.assembly)
};

for (const context of ['checked', 'unchecked']) {
  test(`nonconstant Int32 remainder overflows in ${context} source, reload and emitted CIL`, () => {
    const compiled = compileToIL(`class Program {
      static int Remainder(int left, int right) { return ${context}(left % right); }
      static void Main() { System.Console.WriteLine(Remainder(-2147483648, -1)); }
    }`);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const inspector = new AssemblyInspector(compiled.assembly);
    const method = [...inspector.methods.values()].find(item => item.name === 'Remainder');
    assert(inspector.getMethod(method.token).instructions.some(instruction => instruction.name === 'rem'));
    for (const [engine, create] of Object.entries(engines)) {
      const vm = create(compiled);
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', engine);
        assert.equal(result.fault?.name, 'OverflowException', engine);
        assert.equal(result.output, '', engine);
      } finally { vm.stop(); }
    }
  });
}

test('source, reload and emitted CIL preserve ordinary signed remainders', () => {
  const compiled = compileToIL(`class Program {
    static int Remainder(int left, int right) { return left % right; }
    static void Main() {
      System.Console.WriteLine(Remainder(-2147483648, 2147483647));
      System.Console.WriteLine(Remainder(-2147483648, 1));
      System.Console.WriteLine(Remainder(-17, 3));
      System.Console.WriteLine(Remainder(17, -3));
    }
  }`);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  for (const [engine, create] of Object.entries(engines)) {
    const vm = create(compiled);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.message}`);
      assert.equal(result.output, '-1\n0\n-2\n2\n', engine);
    } finally { vm.stop(); }
  }
});
