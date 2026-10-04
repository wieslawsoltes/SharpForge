import test from 'node:test';
import assert from 'node:assert/strict';
import {binary, compare, float} from '@sharpforge/bytecode';
import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {StackCategory, numericStackTypes} from '../packages/runtime/src/execution/numeric-stack-types.js';
import {specializedNumericHandler} from '../packages/runtime/src/execution/specialized-numeric-handlers.js';
import {specializeNumericHandlers} from '../packages/runtime/src/execution/numeric-specialization.js';
import {cilHandlers} from '../packages/runtime/src/execution/handlers/index.js';
import {managedFixture} from './managed-fixtures.js';

function machine() {
  return {stack: [], pop() { return this.stack.pop(); }, push(value) { this.stack.push(value); }};
}
function outcome(operation) {
  try { return {value: operation()}; }
  catch (error) { return {name: error.name, message: error.message}; }
}
function evaluate(vm, handler, left, right) {
  vm.stack.length = 0;
  vm.stack.push(left, right);
  handler(vm);
  return vm.stack.pop();
}

test('T08.2 one million deterministic Int32 operations match generic numeric execution', () => {
  const names = ['add', 'sub', 'mul', 'div', 'rem', 'div.un', 'rem.un', 'and', 'or', 'xor', 'shl', 'shr', 'shr.un',
    'add.ovf', 'sub.ovf', 'mul.ovf', 'add.ovf.un', 'sub.ovf.un', 'mul.ovf.un'];
  const selected = names.map(name => specializedNumericHandler(name, [StackCategory.i4, StackCategory.i4]).handler);
  const vm = machine();
  let state = 0x76543210;
  for (let index = 0; index < 1_000_000; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    const left = state;
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    const right = state, operation = index % names.length;
    assert.deepEqual(outcome(() => evaluate(vm, selected[operation], left, right)),
      outcome(() => binary(names[operation], left, right)), `${names[operation]}(${left},${right})`);
  }
});

test('T08.2 arithmetic boundaries and managed fault messages stay identical', () => {
  const vm = machine();
  const cases = [['div', -2147483648, -1], ['rem', -2147483648, -1], ['div', 1, 0], ['rem.un', -1, 0],
    ['add.ovf.un', -1, 1], ['mul.ovf', 46341, 46341], ['sub.ovf', -2147483648, 1], ['shr.un', -1, 65]];
  for (const [name, left, right] of cases) {
    const {handler} = specializedNumericHandler(name, [StackCategory.i4, StackCategory.i4]);
    assert.deepEqual(outcome(() => evaluate(vm, handler, left, right)), outcome(() => binary(name, left, right)));
  }
});

for (const category of [StackCategory.i4, StackCategory.i8, StackCategory.r4, StackCategory.r8]) {
  test(`T08.2 compare branches and unordered values use category ${category}`, () => {
    const values = category === StackCategory.i4 ? [0, -1, -2147483648, 2147483647] : category === StackCategory.i8 ?
      [0n, -1n, -(1n << 63n), (1n << 63n) - 1n] : [0, -0, NaN, Infinity, -Infinity].map(value =>
        float(value, category === StackCategory.r4 ? 'r4' : 'r8'));
    const vm = machine(), frame = {pc: 0, offsets: new Map([[12, 4]])}, instruction = {operand: 12};
    for (const name of ['beq.s', 'bne.un.s', 'blt', 'bge.un', 'bgt.un', 'ble']) {
      const {handler} = specializedNumericHandler(name, [category, category]);
      const operation = name.slice(1).split('.')[0], unsigned = name.includes('.un');
      for (const left of values) for (const right of values) {
        frame.pc = 0; vm.stack.push(left, right);
        handler(vm, frame, instruction);
        assert.equal(frame.pc, compare(left, right, operation, unsigned) ? 4 : 0);
        assert.equal(vm.stack.length, 0);
      }
    }
  });
}

test('T08.2 dataflow specializes known locals and stops at incompatible stack joins', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body: writer => writer
    .op('ldc.i4.1').op('stloc.0').op('ldloc.0').op('ldc.i4.2').op('add').op('pop')
    .op('ldc.i4.0').op('brtrue.s', 'wide').op('ldc.i4.1').op('br.s', 'join')
    .mark('wide').op('ldc.i8', 1n).mark('join').op('ldc.i4.1').op('add').op('conv.i4').op('ret')}]});
  const inspector = new AssemblyInspector(bytes), report = verifyCilAssembly(inspector);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  const method = inspector.getMethod(report.entryPoint), offsets = new Map(method.instructions.map((item, index) => [item.offset, index]));
  const states = numericStackTypes(inspector, method, offsets);
  const additions = method.instructions.flatMap((item, index) => item.name === 'add' ? [index] : []);
  assert.deepEqual(states[additions[0]], [StackCategory.i4, StackCategory.i4]);
  assert.equal(states[additions[1]][0], StackCategory.unknown);
  const generic = method.instructions.map(item => cilHandlers.get(item.name));
  const plan = {offsets, handlers: [...generic]};
  specializeNumericHandlers({inspector, options: {}}, method, plan);
  assert.equal(plan.numericHandlerIds[additions[0]], 'add_i4');
  assert.equal(plan.numericHandlerIds[additions[1]], null);
  assert.strictEqual(plan.handlers[additions[1]], generic[additions[1]]);
  const disabled = {offsets, handlers: [...generic]};
  specializeNumericHandlers({inspector, options: {specializeNumericHandlers: false}}, method, disabled);
  assert.deepEqual(disabled.handlers, generic);
});
