import test from 'node:test';
import assert from 'node:assert/strict';
import {int64Binary} from '@sharpforge/bytecode';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {smallLongOperation} from '../packages/runtime/src/execution/int64-fast.js';
import {smallLongHandler} from '../packages/runtime/src/execution/small-long-handlers.js';
import {StackCategory} from '../packages/runtime/src/execution/numeric-stack-types.js';
import {typedFloatArray, floatSlots} from '../packages/runtime/src/execution/typed-stack.js';
import {getDecodePlan} from '../packages/runtime/src/execution/decode-plan.js';
import {managedFixture} from './managed-fixtures.js';

const maximum = BigInt(Number.MAX_SAFE_INTEGER);
const names = ['div', 'rem', 'div.un', 'rem.un'];

function exact(name, left, right) {
  const result = smallLongOperation(name)(Number(left), Number(right));
  if (right === 0n || name.endsWith('.un') && (left < 0n || right < 0n)) {
    assert.equal(result, undefined, `${name}: ${left}, ${right}`);
  } else if (result !== undefined) {
    assert(Number.isSafeInteger(result));
    assert.equal(BigInt(result), int64Binary(name, left, right), `${name}: ${left}, ${right}`);
  }
}

test('safe division and remainder retain truncation at signed limits and every sign combination', () => {
  const values = [-maximum, -maximum + 1n, -(1n << 52n), -65537n, -17n, -3n, -1n,
    0n, 1n, 3n, 17n, 65537n, 1n << 52n, maximum - 1n, maximum];
  for (const name of names) for (const left of values) for (const right of values) exact(name, left, right);
  assert.equal(smallLongOperation('div')(17, 3), 5);
  assert.equal(smallLongOperation('div')(-17, 3), -5);
  assert.equal(smallLongOperation('rem')(-17, 3), -2);
  assert.equal(smallLongOperation('rem')(17, -3), 2);
  assert.equal(smallLongOperation('div')(Number(maximum), -1), -Number(maximum));
  assert.equal(smallLongOperation('rem')(-Number(maximum), 1), 0);
});

test('quotients near integer boundaries are checked against independent exact arithmetic', () => {
  const divisors = [2n, 3n, 5n, 7n, 31n, 65537n, (1n << 26n) - 1n, (1n << 26n) + 1n, maximum / 2n, maximum];
  for (const divisor of divisors) {
    const quotients = [0n, 1n, 2n, maximum / divisor, maximum / divisor - 1n];
    for (let bit = 1n; bit <= 52n; bit += 3n) quotients.push((1n << bit) - 1n, 1n << bit, (1n << bit) + 1n);
    for (const quotient of quotients) for (const delta of [-1n, 0n, 1n, divisor - 1n]) {
      const dividend = quotient * divisor + delta;
      if (dividend < 0n || dividend > maximum) continue;
      for (const signLeft of [-1n, 1n]) for (const signRight of [-1n, 1n]) {
        for (const name of names) exact(name, dividend * signLeft, divisor * signRight);
      }
    }
  }
  let seed = 0x3bf23915n;
  const next = () => {
    seed = BigInt.asIntN(64, seed * 6364136223846793005n + 1442695040888963407n);
    return seed % maximum;
  };
  for (let index = 0; index < 2048; index++) {
    const left = next();
    const right = next();
    for (const name of names) exact(name, left, right);
  }
});

test('declined operations delegate before consuming original small or wide operands', () => {
  const method = {locals: [], signature: {isStatic: true, parameters: []}};
  for (const [name, left, right] of [['div', 1n, 0n], ['rem', -1n, 0n],
    ['div.un', -1n, 3n], ['rem.un', 1n, -3n], ['div', maximum + 2n, 3n]]) {
    const stack = typedFloatArray([left, right], 2, true);
    const frame = {stack};
    const vm = {options: {smallLongs: true},
      pop() { assert.fail('fallback must be selected before any pop'); },
      push() { assert.fail('fallback must be selected before any push'); }};
    let called = 0;
    const generic = (current, currentFrame) => {
      assert.equal(current, vm);
      assert.equal(currentFrame, frame);
      assert.deepEqual([...stack], [left, right]);
      called++;
      return 'fallback';
    };
    const selected = smallLongHandler(method, {name}, [StackCategory.i8, StackCategory.i8], generic);
    assert.equal(selected.handler(vm, frame, {name}), 'fallback');
    assert.equal(called, 1);
    assert.equal(stack.length, 2);
  }
});

test('direct CIL keeps managed divide/remainder faults and unsigned stack-pattern interpretation', () => {
  const values = [[17n, 3n], [-17n, 3n], [maximum, 7n], [-maximum, -3n], [1n, 0n],
    [-1n, 3n], [1n, -3n], [-(1n << 63n), -1n], [maximum + 2n, 3n]];
  for (const name of names) for (const [left, right] of values) {
    const bytes = managedFixture({methods: [{name: 'Main', result: 'long', maxStack: 2,
      body: writer => writer.op('ldc.i8', left).op('ldc.i8', right).op(name).op('ret')} ]});
    const reference = new CilVirtualMachine(bytes).run();
    const vm = new CilVirtualMachine(bytes, {smallLongs: true});
    assert(getDecodePlan(vm, vm.top.method).numericHandlerIds.includes(name.replaceAll('.', '_') + '_small_i8'));
    const actual = vm.run();
    assert.equal(actual.state, reference.state, name);
    assert.equal(actual.returnValue, reference.returnValue, name);
    assert.equal(actual.fault?.name, reference.fault?.name, name);
    assert.equal(actual.fault?.message, reference.fault?.message, name);
  }
});

test('a remainder accumulator stays exact across private Number lanes', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'long', maxStack: 3, locals: ['long', 'long'], body(writer) {
    writer.integer(0).op('conv.i8').op('stloc.0').integer(0).op('conv.i8').op('stloc.1').mark('loop');
    writer.op('ldloc.0').op('ldloc.1').integer(3).op('conv.i8').op('rem').op('add').op('stloc.0');
    writer.op('ldloc.1').integer(1).op('conv.i8').op('add').op('stloc.1');
    writer.op('ldloc.1').integer(100).op('conv.i8').op('blt.s', 'loop').op('ldloc.0').op('ret');
  }}]});
  for (const smallLongs of [false, true]) {
    const vm = new CilVirtualMachine(bytes, {smallLongs});
    let remaining = 2000;
    while (vm.top.method.instructions[vm.top.pc].name !== 'ret') {
      assert(--remaining > 0);
      vm.step();
    }
    if (smallLongs) {
      assert.equal(floatSlots(vm.top.stack).materializations, 0);
      assert.equal(floatSlots(vm.top.locals).materializations, 0);
    }
    assert.equal(vm.run().returnValue, 99n);
  }
});
