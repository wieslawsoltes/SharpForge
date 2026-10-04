import test from 'node:test';
import assert from 'node:assert/strict';
import {float, nativeInteger} from '@sharpforge/bytecode';
import {binary, compare, unary} from '../packages/runtime/src/execution/numeric-ops.js';
import {specializedInt32Handler} from '../packages/runtime/src/execution/handlers/arith-specialized.js';
import {StackCategory} from '../packages/runtime/src/execution/numeric-stack-types.js';

const i4 = StackCategory.i4;
const names = ['add', 'sub', 'mul', 'and', 'or', 'xor', 'shl', 'shr', 'shr.un', 'div', 'rem', 'div.un', 'rem.un',
  'add.ovf', 'sub.ovf', 'mul.ovf', 'add.ovf.un', 'sub.ovf.un', 'mul.ovf.un'];
function outcome(action) {
  try { return {value: action()}; }
  catch (error) { return {name: error.name, message: error.message}; }
}
function machine() {
  const frame = {stack: [], pc: 0, offsets: new Map([[17, 3]])};
  return {frame, options: {specializeNumericHandlers: true}, fallback: 0,
    pop() { return frame.stack.pop(); }, push(value) { frame.stack.push(value); }};
}
function generic(name) {
  return vm => {
    vm.fallback++;
    const right = vm.pop(), left = vm.pop();
    vm.push(binary(name, left, right));
  };
}

test('selected Int32 handlers match reference arithmetic on boundaries and deterministic random inputs', () => {
  const vm = machine();
  let seed = 0x614d91;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) | 0);
  const boundaries = [-2147483648, -2147483647, -65536, -1, 0, 1, 2, 31, 32, 65535, 2147483646, 2147483647];
  for (const name of names) {
    const selected = specializedInt32Handler(name, [i4, i4], generic(name));
    assert.equal(selected.id, name.replaceAll('.', '_') + '_i4');
    const check = (left, right) => {
      vm.frame.stack.length = 0;
      vm.frame.stack.push(left, right);
      const actual = outcome(() => { selected.handler(vm, vm.frame, {}); return vm.pop(); });
      assert.deepEqual(actual, outcome(() => binary(name, left, right)), `${name}: ${left}, ${right}`);
    };
    for (const left of boundaries) for (const right of boundaries) check(left, right);
    for (let index = 0; index < 1024; index++) check(next(), next());
  }
  assert.equal(vm.fallback, 0);
});

test('signed division and remainder overflow, unsigned bounds and zero faults remain exact', () => {
  for (const name of ['div', 'rem']) {
    const vm = machine(), handler = specializedInt32Handler(name, [i4, i4], generic(name)).handler;
    vm.frame.stack.push(-2147483648, -1);
    assert.throws(() => handler(vm, vm.frame, {}), {name: 'OverflowException', message: 'Integer division overflow'});
    vm.frame.stack.push(1, 0);
    assert.throws(() => handler(vm, vm.frame, {}),
      {name: 'DivideByZeroException', message: 'Attempted to divide by zero'});
  }
});

test('comparison branches preserve signed/unsigned ordering and integer result values', () => {
  for (const [name, operation, unsigned] of [['ceq', 'eq', false], ['cgt', 'gt', false], ['clt.un', 'lt', true],
    ['beq.s', 'eq', false], ['bne.un.s', 'ne', true], ['blt.s', 'lt', false], ['bge.un', 'ge', true]]) {
    const vm = machine();
    const selected = specializedInt32Handler(name, [i4, i4], () => assert.fail('canonical comparison fell back'));
    for (const [left, right] of [[-1, 0], [-2147483648, 2147483647], [0, 0], [17, -9]]) {
      vm.frame.pc = 0;
      vm.frame.stack.push(left, right);
      selected.handler(vm, vm.frame, {operand: 17});
      const expected = compare(left, right, operation, unsigned);
      if (name.startsWith('c')) assert.equal(vm.pop(), expected ? 1 : 0);
      else assert.equal(vm.frame.pc, expected ? 3 : 0);
    }
  }
});

test('host-edited noncanonical values retain generic numeric behavior', () => {
  const vm = machine();
  const handler = specializedInt32Handler('add', [i4, i4], generic('add')).handler;
  for (const [left, right] of [[float(1.5), float(2)], [1n, 2n], [nativeInteger(1, 32), 2],
    [1.5, 2], [4294967295, 1], [NaN, 1], [null, 1]]) {
    vm.frame.stack.length = 0;
    vm.frame.stack.push(left, right);
    assert.deepEqual(outcome(() => { handler(vm, vm.frame, {}); return vm.pop(); }), outcome(() => binary('add', left, right)));
  }
  assert.equal(vm.fallback, 7);
  assert.equal(specializedInt32Handler('add', [StackCategory.i8, i4], generic('add')), null);
  assert.equal(specializedInt32Handler('add', null, generic('add')), null);
  assert.equal(specializedInt32Handler('div.ovf', [i4, i4], generic('div.ovf')), null);
  for (const name of ['neg', 'not']) {
    const selected = specializedInt32Handler(name, [i4], () => assert.fail('canonical unary fell back'));
    for (const value of [-2147483648, -1, 0, 1, 2147483647]) {
      vm.frame.stack.length = 0;
      vm.frame.stack.push(value);
      selected.handler(vm, vm.frame, {});
      assert.equal(vm.pop(), unary(name, value));
    }
  }
});
