import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {VirtualDispatch} from '../packages/runtime/src/execution/vtable.js';
import {controlFixture} from './support/control-fixture.js';

function fixture({sealed = false, abstract = false} = {}) {
  const constructor = {name: '.ctor', static: false, body: writer => writer.op('ret')};
  return controlFixture([
    {name: 'Base', flags: abstract ? 0x100081 : 0x100001, methods: [constructor,
      {name: 'Value', static: false, result: 'int', flags: abstract ? 0x5c6 : sealed ? 0x1e6 : 0x1c6,
        ...(abstract ? {} : {body: writer => writer.op('ldc.i4.1').op('ret')})}]},
    {name: 'Derived', base: 'Base', methods: [constructor,
      {name: 'Value', static: false, result: 'int', flags: sealed ? 0xc6 : 0x1c6,
        body: writer => writer.op('ldc.i4.2').op('ret')}]},
    {name: 'Program', methods: [{name: 'Main', result: 'int', body(writer, context) {
      writer.op('newobj', context.methods.get('Derived..ctor'));
      writer.op('callvirt', context.methods.get('Base.Value')).op('ret');
    }}]}
  ]);
}

test('T02.1 newslot hiding retains the base declaration slot', () => {
  const vm = new CilVirtualMachine(fixture());
  assert.equal(vm.run().returnValue, 1);
});

test('T02.1 warmed dispatch reads its slot index without enumerating declarations', () => {
  const inspector = new AssemblyInspector(fixture());
  const dispatch = new VirtualDispatch(inspector);
  const method = [...inspector.methods.values()].find(item => item.owner === 'Base' && item.name === 'Value');
  const table = dispatch.table('Derived');
  table.declarations.values = () => { throw new Error('Dispatch scanned declarations'); };
  for (let i = 0; i < 100; i++) assert.equal(dispatch.resolve('Derived', method.token), method.token);
  assert.equal(table.targets[table.declarationsByToken.get(method.token).get('Base')], method.token);
});

test('T02.1 overriding a final slot is rejected while abstract dispatch faults explicitly', () => {
  const report = verifyCilAssembly(fixture({sealed: true}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => /final virtual/.test(issue.message)));
  const inspector = new AssemblyInspector(fixture({abstract: true}));
  const dispatch = new VirtualDispatch(inspector);
  const method = [...inspector.methods.values()].find(item => item.owner === 'Base' && item.name === 'Value');
  assert.throws(() => dispatch.resolve('Base', method.token), {name: 'MemberAccessException'});
});
