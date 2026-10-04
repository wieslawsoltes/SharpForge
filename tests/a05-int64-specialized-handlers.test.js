import test from 'node:test';
import assert from 'node:assert/strict';
import {float, nativeInteger} from '@sharpforge/bytecode';
import {binary, compare, unary} from '../packages/runtime/src/execution/numeric-ops.js';
import {specializedInt64Handler} from '../packages/runtime/src/execution/handlers/int64-specialized.js';
import {StackCategory} from '../packages/runtime/src/execution/numeric-stack-types.js';

const i8 = StackCategory.i8;
const i4 = StackCategory.i4;
const minimum = -(1n << 63n);
const maximum = (1n << 63n) - 1n;
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
    const right = vm.pop();
    const left = vm.pop();
    vm.push(binary(name, left, right));
  };
}

test('Int64 selected arithmetic matches shared reference at full-width boundaries and deterministic inputs', () => {
  const vm = machine();
  let seed = 0x614d919483n;
  const next = () => (seed = BigInt.asIntN(64, seed * 6364136223846793005n + 1442695040888963407n));
  const boundaries = [minimum, minimum + 1n, -9007199254740993n, -1n, 0n, 1n, 63n, 64n, 9007199254740993n, maximum];
  for (const name of names) {
    const selected = specializedInt64Handler(name, [i8, i8], generic(name));
    assert.equal(selected.id, name.replaceAll('.', '_') + '_i8');
    const check = (left, right) => {
      vm.frame.stack.length = 0;
      vm.frame.stack.push(left, right);
      const actual = outcome(() => { selected.handler(vm, vm.frame, {}); return vm.pop(); });
      assert.deepEqual(actual, outcome(() => binary(name, left, right)), `${name}: ${left}, ${right}`);
    };
    for (const left of boundaries) for (const right of boundaries) check(left, right);
    for (let index = 0; index < 256; index++) check(next(), next());
  }
  assert.equal(vm.fallback, 0);
});

test('Int64 shifts accept proven Int32 counts and preserve six-bit masking', () => {
  for (const name of ['shl', 'shr', 'shr.un']) {
    const vm = machine();
    const selected = specializedInt64Handler(name, [i8, i4], generic(name));
    for (const left of [minimum, -1n, 1n, maximum]) {
      for (const right of [-2147483648, -65, -1, 0, 1, 63, 64, 127, 2147483647]) {
        vm.frame.stack.push(left, right);
        selected.handler(vm, vm.frame, {});
        assert.equal(vm.pop(), binary(name, left, right));
      }
    }
    assert.equal(vm.fallback, 0);
  }
});

test('signed division and remainder preserve managed overflow and zero faults after consuming both operands', () => {
  for (const name of ['div', 'rem']) {
    const vm = machine();
    const {handler} = specializedInt64Handler(name, [i8, i8], generic(name));
    vm.frame.stack.push(minimum, -1n);
    assert.throws(() => handler(vm, vm.frame, {}), {name: 'OverflowException', message: 'Integer division overflow'});
    assert.equal(vm.frame.stack.length, 0);
    vm.frame.stack.push(1n, 0n);
    assert.throws(() => handler(vm, vm.frame, {}),
      {name: 'DivideByZeroException', message: 'Attempted to divide by zero'});
    assert.equal(vm.frame.stack.length, 0);
  }
});

test('signed and unsigned comparisons preserve integer results and original branch targets', () => {
  const forms = [['ceq', 'eq'], ['clt', 'lt'], ['cgt', 'gt'], ['clt.un', 'lt'], ['cgt.un', 'gt']];
  for (const [stem, operation] of [['beq', 'eq'], ['bne.un', 'ne'], ['blt', 'lt'], ['ble', 'le'], ['bgt', 'gt'], ['bge', 'ge']]) {
    for (const suffix of stem.includes('.un') || stem === 'beq' ? ['', '.s'] : ['', '.s', '.un', '.un.s']) {
      forms.push([stem + suffix, operation]);
    }
  }
  for (const [name, operation] of forms) {
    const vm = machine();
    const selected = specializedInt64Handler(name, [i8, i8], () => assert.fail('canonical comparison fell back'));
    for (const [left, right] of [[-1n, 0n], [minimum, maximum], [0n, 0n], [9007199254740993n, 9007199254740992n]]) {
      vm.frame.pc = 0;
      vm.frame.stack.push(left, right);
      selected.handler(vm, vm.frame, {operand: 17});
      const expected = compare(left, right, operation, name.includes('.un'));
      if (name.startsWith('c')) assert.equal(vm.pop(), expected ? 1 : 0);
      else assert.equal(vm.frame.pc, expected ? 3 : 0);
    }
  }
});

test('unary wrapping and guarded host edits keep generic value and fault semantics', () => {
  for (const name of ['neg', 'not']) {
    const vm = machine();
    const selected = specializedInt64Handler(name, [i8], machine => {
      machine.fallback++;
      machine.push(unary(name, machine.pop()));
    });
    for (const value of [minimum, -1n, 0n, 1n, maximum, 1n << 64n, float(1.5)]) {
      vm.frame.stack.length = 0;
      vm.frame.stack.push(value);
      assert.deepEqual(outcome(() => { selected.handler(vm, vm.frame, {}); return vm.pop(); }), outcome(() => unary(name, value)));
    }
    assert.equal(vm.fallback, 2);
  }
  const vm = machine();
  const handler = specializedInt64Handler('add', [i8, i8], generic('add')).handler;
  for (const [left, right] of [[float(1.5), float(2)], [1, 2], [1n, 2], [nativeInteger(1, 32), 2],
    [1n << 64n, 1n], [1n, minimum - 1n], [null, 1n]]) {
    vm.frame.stack.length = 0;
    vm.frame.stack.push(left, right);
    assert.deepEqual(outcome(() => { handler(vm, vm.frame, {}); return vm.pop(); }), outcome(() => binary('add', left, right)));
  }
  assert.equal(vm.fallback, 7);
  vm.options.specializeNumericHandlers = false;
  vm.frame.stack.push(1n, 2n);
  handler(vm, vm.frame, {});
  assert.equal(vm.pop(), 3n);
  assert.equal(vm.fallback, 8);
  for (const [name, state] of [['add', null], ['add', [i4, i8]], ['add', [i8, i4]], ['div.ovf', [i8, i8]],
    ['shl', [i8, StackCategory.native]], ['ceq', [i8, StackCategory.unknown]]]) {
    assert.equal(specializedInt64Handler(name, state, generic(name)), null);
  }
});
