import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';

function assembly() {
  return controlFixture([{name: 'Program', methods: [{
    name: 'Main', result: 'int',
    body(writer) {
      writer.mark('try').op('nop').op('leave', 'done');
      writer.mark('finally').op('nop').op('endfinally');
      writer.mark('done').op('ldc.i4', 42).op('ret');
    },
    handlers: labels => [{flags: 2, start: labels.get('try'), end: labels.get('finally'),
      target: labels.get('finally'), handlerEnd: labels.get('done')}]
  }]}]);
}

test('CIL execution budgets do not become structural EH instruction limits', () => {
  for (const maxInstructions of [1, 20_000_000]) {
    const vm = new CilVirtualMachine(assembly(), {maxInstructions});
    assert.equal(vm.report.success, true);
    const result = vm.run();
    if (maxInstructions === 1) {
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, 'InstructionLimitException');
    } else {
      assert.equal(result.state, 'terminated');
      assert.equal(result.returnValue, 42);
    }
    vm.stop();
  }
});

test('standalone structural instruction limits remain bounded and enforced', () => {
  const inspector = new AssemblyInspector(assembly());
  for (const [maxInstructions, diagnostic] of [[0, 'CILR0029'], [20_000_000, 'CILR0001']]) {
    const report = verifyCilAssembly(inspector, {maxInstructions});
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.diagnostic === diagnostic), JSON.stringify(report.issues));
  }
  assert.throws(() => new CilVirtualMachine(new AssemblyInspector(assembly(), {maxInstructions: 1})), /instruction limit/i);
});
