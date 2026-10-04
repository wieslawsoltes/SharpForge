import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CilVirtualMachine
} from '@sharpforge/runtime';
import {
  controlFixture
} from './support/control-fixture.js';
import {
  frameById
} from '../packages/runtime/src/execution/frame-lifetimes.js';
import {
  enterFilter,
  finishFilter
} from '../packages/runtime/src/execution/eh-filters.js';

function setup(options = {}) {
  const bytes = controlFixture([{
    name: 'Program',
    methods: [{
      name: 'Main',
      locals: ['int'],
      body: writer => writer.op('ret')
    }]
  }]);
  const vm = new CilVirtualMachine(bytes, options);
  const owner = vm.top;
  const handler = {
    catchType: 0,
    target: 0,
    handlerEnd: 1
  };
  const search = {
    error: {
      reference: null
    },
    selection: null
  };
  return {
    vm,
    owner,
    handler,
    search
  };
}

test('T04.2 filter frames share locals/arguments and release only their own lifetime', () => {
  const {
    vm,
    owner,
    handler,
    search
  } = setup();
  const filter = enterFilter(vm, owner, handler, search);
  assert.equal(filter.args, owner.args);
  assert.equal(filter.locals, owner.locals);
  filter.locals[0] = 42;
  assert.equal(owner.locals[0], 42);
  assert.equal(frameById(vm, filter.id), filter);
  assert.equal(finishFilter(vm, 1), search);
  assert.equal(search.selection.frameId, owner.id);
  assert.equal(vm.top, owner);
  assert.throws(() => frameById(vm, filter.id), {
    name: 'InvalidProgramException'
  });
  assert.equal(frameById(vm, owner.id), owner);
  assert.equal(vm.frames.length, 1);
});

test('T04.2 false and escaping-filter decisions resume the original search', () => {
  const {
    vm,
    owner,
    handler,
    search
  } = setup();
  enterFilter(vm, owner, handler, search);
  assert.equal(finishFilter(vm, 0), search);
  assert.equal(search.selection, null);
  assert.equal(vm.top, owner);
});

for (const value of [0.5, NaN, 2147483648]) {
  test(`T04.2 non-Int32 endfilter decision is rejected atomically: ${value}`, () => {
    const {
      vm,
      owner,
      handler,
      search
    } = setup();
    const filter = enterFilter(vm, owner, handler, search);
    assert.throws(() => finishFilter(vm, value), {
      name: 'InvalidProgramException'
    });
    assert.equal(vm.top, filter);
    assert.equal(search.selection, null);
  });
}

test('T04.2 explicit filter admission failure leaves its declaring frame alive', () => {
  const {
    vm,
    owner,
    handler,
    search
  } = setup({
    maxFrames: 1
  });
  assert.throws(() => enterFilter(vm, owner, handler, search), error =>
    error.name === 'StackOverflowException' && error.fatal && error.runtimeOrigin);
  assert.equal(vm.top, owner);
  assert.equal(vm.frames.length, 1);
});
