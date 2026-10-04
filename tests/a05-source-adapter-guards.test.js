import test from 'node:test';
import assert from 'node:assert/strict';
import {Op} from '@sharpforge/bytecode';
import {VirtualMachine, executionCodeStatistics} from '@sharpforge/runtime';
import {sourceFusionFixture} from './support/source-fusion-fixture.js';

function fixture(hook) {
  const image = sourceFusionFixture();
  if (hook === 'call') {
    const target = {...image.methods[0], id: 1, name: 'Value', qualifiedName: 'Value',
      code: Int32Array.from([Op.CONST, 2, 0, Op.RET, 0, 0])};
    image.methods.push(target);
    image.methods[0].code = Int32Array.from([Op.NOP, 0, 0, Op.CALL, 1, 0, Op.NOP, 0, 0, Op.RET, 0, 0]);
  }
  return image;
}

for (const hook of ['call', 'binary', 'transfer', 'constant', 'notifyWrite']) {
  test(`an inherited source ${hook} adapter retains ordinary calls and instruction state`, () => {
    const observed = [];
    for (const sourceFusion of [false, true]) {
      let calls = 0;
      class ObservedVM extends VirtualMachine {
        [hook](...args) {
          calls++;
          return super[hook](...args);
        }
      }
      const vm = new ObservedVM(fixture(hook), {sourceFusion});
      calls = 0;
      vm.top.locals[0] = 6;
      vm.top.locals[1] = 7;
      try {
        vm.run();
        assert(calls > 0);
        assert.equal(executionCodeStatistics(vm).sourceFusionGroups, 0);
        observed.push({calls, state: vm.state, result: vm.returnValue, instructions: vm.instructions, writes: vm.writeRevision});
      } finally { vm.stop(); }
    }
    assert.deepEqual(observed[1], observed[0]);
  });
}

test('a prototype adapter installed before construction remains visible to fused source execution', context => {
  const constant = VirtualMachine.prototype.constant;
  let calls = 0;
  context.mock.method(VirtualMachine.prototype, 'constant', function(index) {
    calls++;
    return constant.call(this, index);
  });
  const vm = new VirtualMachine(sourceFusionFixture());
  vm.top.locals[0] = 6;
  vm.top.locals[1] = 7;
  try {
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.returnValue, 42);
    assert(calls > 0);
    assert.equal(executionCodeStatistics(vm).sourceFusionGroups, 0);
  } finally { vm.stop(); }
});
