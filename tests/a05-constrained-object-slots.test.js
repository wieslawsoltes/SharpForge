import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {objectSlotFixture} from './support/constrained-object-slots-fixture.js';

function withVM(options, action, vmOptions = {}) {
  const bytes = objectSlotFixture(options), report = verifyCilAssembly(bytes);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  const vm = new CilVirtualMachine(bytes, vmOptions);
  try { action(vm); } finally { vm.stop(); }
}

for (const operation of ['ToString', 'Equals', 'GetHashCode']) for (const generic of [false, true]) {
  for (const kind of ['int', 'struct', 'class']) for (const override of kind === 'int' ? [false] : [false, true]) {
    test(`${generic ? 'generic' : 'concrete'} ${kind} ${operation} ${override ? 'override' : 'default'} preserves its Object slot`, () => {
      withVM({operation, kind, override, generic}, vm => {
        const allocations = vm.heap.stats.allocations;
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.message);
        if (operation === 'ToString') assert.equal(vm.format(vm.returnValue), override ? 'custom' : kind === 'int' ? '23' : 'Receiver');
        else if (operation === 'Equals') assert.equal(vm.returnValue, 1);
        else if (override || kind === 'int') assert.equal(vm.returnValue, override ? 37 : 23);
        else assert.equal(Number.isInteger(vm.returnValue), true);
        if (kind !== 'class') {
          const resultString = Number(operation === 'ToString');
          const argumentBox = Number(operation === 'Equals');
          const receiverBox = Number(kind === 'struct' && !override);
          assert.equal(vm.heap.stats.allocations - allocations, resultString + argumentBox + receiverBox,
            'only a default struct receiver boxes; overrides retain the original managed address');
        }
      }, {decodePlans: !generic});
    });
  }
}

for (const operation of ['ToString', 'Equals', 'GetHashCode']) for (const override of [false, true]) {
  for (const kind of ['struct', 'class']) test(`closed generic ${kind} ${operation} ${override ? 'override' : 'default'}`, () => {
    withVM({operation, override, kind, closedGeneric: true, generic: true}, vm => {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      if (operation === 'ToString') assert.equal(vm.format(vm.returnValue), override ? 'custom' : 'Receiver`1[System.Int32]');
      else if (operation === 'Equals') assert.equal(vm.returnValue, 1);
      else if (override) assert.equal(vm.returnValue, 37);
      else assert(Number.isInteger(vm.returnValue));
    });
  });
}

for (const kind of ['int', 'struct', 'class']) test(`default ${kind} Equals rejects a different value`, () => {
  withVM({operation: 'Equals', kind, same: false, generic: true}, vm => {
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.equal(vm.returnValue, 0);
  });
});

for (const operation of ['Equals', 'GetHashCode']) test(`${operation} override mutates original storage without changing its earlier copy`, () => {
  withVM({operation, override: true}, vm => {
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000, onInstruction(instruction, frame) {
      return frame.method.name === 'Main' && instruction.name === 'ret';
    }});
    assert.equal(vm.state, 'paused');
    assert.equal(vm.top.locals[0].fields[0], 24);
    assert.equal(vm.top.locals[1].fields[0], 23);
    assert(vm.heap.stats.collections > 0);
    vm.state = 'running';
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
  });
});

for (const operation of ['Equals', 'GetHashCode']) test(`hidden ${operation} does not replace the Object slot`, () => {
  withVM({operation, newSlot: true, same: false}, vm => {
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    if (operation === 'Equals') assert.equal(vm.returnValue, 0);
    else assert.notEqual(vm.returnValue, 37);
    assert.equal(vm.heap.stats.collections, 0, 'the hidden managed body was not invoked');
  });
});

for (const operation of ['Equals', 'GetHashCode']) test(`${operation} rejects a foreign managed receiver before dispatch`, () => {
  withVM({operation, override: true}, vm => withVM({operation, override: true}, foreign => {
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
      onInstruction: instruction => instruction.name === 'constrained.'});
    assert.equal(vm.state, 'paused');
    vm.top.stack[0] = foreign.address('local', 0);
    vm.state = 'running';
    assert.equal(vm.run().fault?.name, 'InvalidProgramException');
  }));
});

test('generic value flags remain enforced when Object call admission accepts both reference and value substitutions', () => {
  withVM({operation: 'GetHashCode', kind: 'class', generic: true, parameterFlags: 8}, vm => {
    assert.equal(vm.run().fault?.name, 'ArgumentException');
  });
});
