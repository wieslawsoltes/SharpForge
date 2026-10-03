import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, CilDispatchTable, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {dispatchFixture} from './support/dispatch-fixture.js';

const ctor = base => ({name: '.ctor', result: 'void', flags: 0x1886,
  body: (writer, context) => writer.op('ldarg.0')
    .op('call', base ? context.methods.get(base + '::.ctor') : context.objectCtor()).op('ret')});
const constant = (name, value, flags = 0x1c6) => ({name, flags,
  body: writer => writer.op('ldc.i4', value).op('ret')});
const method = (inspector, name) => [...inspector.methods.values()].find(item => item.owner + '::' + item.name === name).token;
const type = (inspector, name) => inspector.types.find(item => item.name === name).token;
const invoke = (owner, declaration) => (writer, context) => writer.op('newobj', context.methods.get(owner + '::.ctor'))
  .op('callvirt', context.methodRef(declaration)).op('ret');
const run = assembly => {
  const result = new CilVirtualMachine(assembly).run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  return result.returnValue;
};

for (const memberRef of [false, true]) test(`base calls and independent hiding slots through ${memberRef ? 'MemberRef' : 'MethodDef'}`, () => {
  const assembly = dispatchFixture([
    {name: 'A', methods: [ctor(), constant('F', 1)]},
    {name: 'B', base: 'A', methods: [ctor('A'), constant('F', 2, 0xc6)]},
    {name: 'C', base: 'B', methods: [ctor('B'), constant('F', 3)]},
    {name: 'D', base: 'C', methods: [ctor('C'), constant('F', 4, 0xc6)]}
  ], (writer, context) => writer.op('newobj', context.methods.get('D::.ctor')).op('stloc.0')
    .op('ldloc.0').op('call', context.methodRef('A::F')).op('ldc.i4', 1000).op('mul')
    .op('ldloc.0').op('callvirt', context.methodRef('A::F')).op('ldc.i4', 100).op('mul').op('add')
    .op('ldloc.0').op('call', context.methodRef('C::F')).op('ldc.i4', 10).op('mul').op('add')
    .op('ldloc.0').op('callvirt', context.methodRef('C::F')).op('add').op('ret'), {memberRef});
  assert.equal(run(assembly), 1234);
});

test('a sealed override remains callable while a derived newslot stays independent', () => {
  const assembly = dispatchFixture([
    {name: 'A', methods: [ctor(), constant('F', 1)]},
    {name: 'B', base: 'A', methods: [ctor('A'), constant('F', 2, 0xe6)]},
    {name: 'C', base: 'B', methods: [ctor('B'), constant('F', 3)]}
  ], (writer, context) => writer.op('newobj', context.methods.get('C::.ctor')).op('stloc.0')
    .op('ldloc.0').op('callvirt', context.methodRef('A::F')).op('ldc.i4', 10).op('mul')
    .op('ldloc.0').op('callvirt', context.methodRef('C::F')).op('add').op('ret'));
  assert.equal(run(assembly), 23);
});

function aliasedAssembly(memberRef = false) {
  return dispatchFixture([
    {name: 'A', methods: [ctor(), constant('F', 1)]},
    {name: 'B', base: 'A', methods: [ctor('A'), constant('Different', 2)]},
    {name: 'C', base: 'B', methods: [ctor('B'), constant('Other', 3)]},
    {name: 'D', base: 'C', methods: [ctor('C'), constant('Other', 9, 0xc6)]}
  ], invoke('D', 'A::F'), {memberRef, methodImpl: [
    ['B', 'B::Different', 'A::F'], ['C', 'C::Other', 'B::Different']
  ]});
}

test('MethodImpl alias chains are materialized once and follow the final overriding body', () => {
  const assembly = aliasedAssembly();
  assert.equal(run(assembly), 9);
  const inspector = new AssemblyInspector(assembly);
  class CountingDispatch extends CilDispatchTable {
    resolveSlot(table, slot) {
      this.slotResolutions = (this.slotResolutions ?? 0) + 1;
      return super.resolveSlot(table, slot);
    }
  }
  const dispatch = new CountingDispatch(inspector);
  const owner = type(inspector, 'D');
  const declaration = method(inspector, 'A::F');
  const expected = method(inspector, 'D::Other');
  const table = dispatch.table(owner);
  const resolutions = dispatch.slotResolutions;
  assert.equal(Object.isFrozen(table.targets), true);
  assert.equal(table.targets[table.slotIndexes.get(declaration)], expected);
  for (let iteration = 0; iteration < 100000; iteration++) assert.equal(dispatch.resolve(owner, declaration), expected);
  assert.equal(dispatch.slotResolutions, resolutions, 'warm dispatch must not walk MethodImpl aliases');
});

test('MemberRef declarations cache their canonical MethodDef without reparsing signatures on dispatch', () => {
  class CountingInspector extends AssemblyInspector {
    resolveToken(token, depth) {
      this.resolutions = (this.resolutions ?? 0) + 1;
      return super.resolveToken(token, depth);
    }
  }
  const inspector = new CountingInspector(aliasedAssembly(true));
  const operand = inspector.getMethod(inspector.pe.entryPoint).instructions.find(instruction => instruction.name === 'callvirt').operand;
  const dispatch = new CilDispatchTable(inspector);
  const owner = type(inspector, 'D');
  const expected = method(inspector, 'D::Other');
  assert.equal(dispatch.resolve(owner, operand), expected);
  const resolutions = inspector.resolutions;
  for (let iteration = 0; iteration < 100; iteration++) assert.equal(dispatch.resolve(owner, operand), expected);
  assert.equal(inspector.resolutions, resolutions);
});

function abstractAssembly(nullReceiver = false) {
  return dispatchFixture([
    {name: 'A', flags: 0x100081, methods: [ctor(), {name: 'F', flags: 0x5c6}]},
    {name: 'B', base: 'A', methods: [ctor('A'), constant('F', 7, 0xc6)]},
    {name: 'Unrelated', methods: [ctor(), constant('F', 8)]}
  ], (writer, context) => {
    if (nullReceiver) writer.op('ldnull');
    else writer.op('newobj', context.methods.get('B::.ctor'));
    writer.op('callvirt', context.methodRef('A::F')).op('ret');
  });
}

test('abstract declarations remain verifiable through concrete implementations and fault when directly resolved', () => {
  const assembly = abstractAssembly();
  const vm = new CilVirtualMachine(assembly);
  const declaration = method(vm.inspector, 'A::F');
  assert.equal(vm.report.methods.includes(declaration), false, 'an abstract declaration has no body to verify');
  const descriptor = vm.inspector.resolveToken(declaration);
  const abstractReceiver = vm.heap.object(vm.typeSystem.table('A'), []);
  assert.throws(() => vm.typeSystem.virtualTarget(abstractReceiver, descriptor, declaration), {
    name: 'MemberAccessException', message: 'An abstract method has no executable implementation'
  });
  const unrelated = vm.heap.object(vm.typeSystem.table('Unrelated'), []);
  assert.throws(() => vm.typeSystem.virtualTarget(unrelated, descriptor, declaration), /receiver is incompatible/);
  assert.equal(run(assembly), 7);
  const nullCall = new CilVirtualMachine(abstractAssembly(true)).run();
  assert.equal(nullCall.state, 'faulted');
  assert.equal(nullCall.fault.name, 'NullReferenceException');
});

test('missing implementations and cyclic MethodImpl mappings remain verification failures', () => {
  const missing = dispatchFixture([
    {name: 'A', flags: 0x100081, methods: [ctor(), {name: 'F', flags: 0x5c6}]}
  ], (writer, context) => writer.op('ldnull').op('callvirt', context.methodRef('A::F')).op('ret'));
  assert.match(JSON.stringify(verifyCilAssembly(missing).issues), /no executable implementation/);
  const cycle = dispatchFixture([
    {name: 'A', methods: [ctor(), constant('F', 1), constant('G', 2)]}
  ], invoke('A', 'A::F'), {methodImpl: [['A', 'A::F', 'A::G'], ['A', 'A::G', 'A::F']]});
  const report = verifyCilAssembly(cycle);
  assert.equal(report.success, false);
  assert.match(JSON.stringify(report.issues), /Cyclic MethodImpl slot mapping/);
});

test('snapshot replay retains derived slot identity without serializing dispatch caches', () => {
  const vm = new CilVirtualMachine(aliasedAssembly());
  const saved = vm.snapshot();
  const table = vm.typeSystem.dispatch.table(type(vm.inspector, 'D'));
  const first = vm.run();
  vm.restore(saved);
  const second = vm.run();
  assert.equal(first.state, 'terminated');
  assert.equal(second.state, 'terminated');
  assert.equal(first.returnValue, 9);
  assert.equal(second.returnValue, 9);
  assert.deepEqual(vm.typeSystem.dispatch.table(type(vm.inspector, 'D')).targets, table.targets);
  assert.equal(Object.hasOwn(saved, 'typeSystem'), false);
});
