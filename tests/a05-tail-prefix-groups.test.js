import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {verifyCilAssembly} from '@sharpforge/cil';
import {controlFixture} from './support/control-fixture.js';

function fixture({reverse = false, wrongResult = false, interiorBranch = false, unrelated = false} = {}) {
  return controlFixture([{name: 'Program', methods: [{
    name: 'Main', result: wrongResult ? 'object' : 'string', locals: ['int'],
    body(writer, context) {
      writer.op('ldc.i4', 42).op('stloc.0').op('ldloca.s', 0);
      if (interiorBranch) writer.op('br', 'interior');
      if (reverse) writer.op('constrained.', context.resolve('System.Int32')).label('interior').op('tail.');
      else writer.op('tail.').label('interior').op('constrained.', context.resolve('System.Int32'));
      writer.op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
    }
  }]}, ...(unrelated ? [{name: 'Unrelated', methods: [{name: 'ToString', static: false, flags: 0xc6, result: 'string',
    body(writer, context) {
      writer.op('call', context.member('System.Console', 'UnregisteredUnreachableOperation', 'void'))
        .op('ldnull').op('ret');
    }}]}] : [])]);
}

for (const reverse of [false, true]) {
  test(`T02.7 grouped tail/constrained admission resolves the call target, reversed=${reverse}`, () => {
    const bytes = fixture({reverse});
    const report = verifyCilAssembly(bytes);
    assert.equal(report.success, true, JSON.stringify(report.issues));
    const vm = new CilVirtualMachine(bytes);
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, '42');
  });
  test(`T02.7 grouped tail preserves exact return and group boundaries, reversed=${reverse}`, () => {
    const wrong = verifyCilAssembly(fixture({reverse, wrongResult: true}));
    assert.equal(wrong.success, false);
    assert(wrong.issues.some(issue => issue.message.includes('preserve the caller return type')));
    const branch = verifyCilAssembly(fixture({reverse, interiorBranch: true}));
    assert.equal(branch.success, false);
    assert(branch.issues.some(issue => /instruction-group boundary/.test(issue.message)));
  });
}

for (const reverse of [false, true]) test(`T02.7 constrained prefix groups exclude unrelated overrides, reversed=${reverse}`, () => {
  const report = verifyCilAssembly(fixture({reverse, unrelated: true}));
  assert.equal(report.success, true, JSON.stringify(report.issues));
  assert.deepEqual(report.methods, [0x06000001]);
});
