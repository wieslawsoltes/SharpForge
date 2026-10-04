import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCilAssembly, methodSignature} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {dispatchFixture} from './support/dispatch-fixture.js';

const ctor = base => ({name: '.ctor', result: 'void', flags: 0x1886,
  body: (writer, context) => writer.op('ldarg.0')
    .op('call', base ? context.methods.get(base + '::.ctor') : context.objectCtor()).op('ret')});
const constant = (name, value, flags = 0x1c6) => ({name, flags,
  body: writer => writer.op('ldc.i4', value).op('ret')});
const iface = (name, methods = []) => ({name, interface: true, flags: 0xa1, methods});
const invoke = (owner, declaration) => (writer, context) => writer.op('newobj', context.methods.get(owner + '::.ctor'))
  .op('callvirt', context.methodRef(declaration)).op('ret');
const run = assembly => {
  const result = new CilVirtualMachine(assembly).run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  return result.returnValue;
};

function diamond(kind, reverse = false) {
  const defaultsOnly = kind === 'diamond-default';
  const methodImpl = defaultsOnly ? [] : [
    ['ILeft', 'ILeft::LeftValue', 'IBase::Value'], ['IRight', 'IRight::RightValue', 'IBase::Value']
  ];
  if (kind === 'specific') methodImpl.push(['ILeaf', 'ILeaf::LeafValue', 'IBase::Value']);
  if (kind === 'explicit') methodImpl.push(['Impl', 'Impl::Chosen', 'IBase::Value']);
  const interfaces = [['ILeft', 'IBase'], ['IRight', 'IBase'], ['ILeaf', 'ILeft'], ['ILeaf', 'IRight'],
    ['Impl', kind === 'default' ? 'IBase' : 'ILeaf']];
  if (reverse) interfaces.reverse();
  const left = constant('LeftValue', 2, 0x1e1);
  if (kind === 'invalid-body') left.body = writer => writer.op('ldarg.1').op('pop').op('ldc.i4.2').op('ret');
  return dispatchFixture([
    iface('IBase', [constant('Value', 1)]),
    iface('ILeft', defaultsOnly ? [] : [left]),
    iface('IRight', defaultsOnly ? [] : [constant('RightValue', 3, 0x1e1)]),
    iface('ILeaf', kind === 'specific' ? [constant('LeafValue', 4, 0x1e1)] : []),
    {name: 'Impl', methods: [ctor(),
      ...(kind === 'implicit' ? [constant('Value', 5, 0x1e6)] : []),
      ...(kind === 'explicit' ? [constant('Chosen', 6, 0x1e1)] : []),
      ...(kind === 'private' ? [constant('Value', 99, 0x1c1)] : [])]}
  ], invoke('Impl', 'IBase::Value'), {interfaces, methodImpl});
}

for (const reverse of [false, true]) {
  for (const [kind, result] of [['default', 1], ['diamond-default', 1], ['specific', 4], ['implicit', 5], ['explicit', 6]]) {
    test(`interface ${kind} selection is independent of InterfaceImpl order (${reverse})`, () => {
      assert.equal(run(diamond(kind, reverse)), result);
    });
  }
}

test('ambiguous diamonds are verifiable and fault only when their declaration is invoked', () => {
  const assembly = diamond('ambiguous');
  const report = verifyCilAssembly(assembly);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  const vm = new CilVirtualMachine(assembly);
  const result = vm.run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'System.Runtime.AmbiguousImplementationException');
  const competing = [...vm.inspector.methods.values()].filter(method => ['LeftValue', 'RightValue'].includes(method.name));
  assert(competing.every(method => report.methods.includes(method.token)));
  const bad = verifyCilAssembly(diamond('invalid-body'));
  assert.equal(bad.success, false);
  assert(bad.issues.some(issue => issue.code === 'IL_SLOT'));
});

test('a private method cannot silently resolve an otherwise ambiguous interface slot', () => {
  const result = new CilVirtualMachine(diamond('private')).run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'System.Runtime.AmbiguousImplementationException');
});

test('new interface declarations do not override a base declaration without MethodImpl', () => {
  const assembly = dispatchFixture([
    iface('IBase', [constant('Value', 1)]), iface('ILeaf', [constant('Value', 2)]),
    {name: 'Impl', methods: [ctor()]}
  ], (writer, context) => writer.op('newobj', context.methods.get('Impl::.ctor')).op('stloc.0')
    .op('ldloc.0').op('callvirt', context.methodRef('IBase::Value')).op('ldc.i4', 10).op('mul')
    .op('ldloc.0').op('callvirt', context.methodRef('ILeaf::Value')).op('add').op('ret'),
  {interfaces: [['ILeaf', 'IBase'], ['Impl', 'ILeaf']]});
  assert.equal(run(assembly), 12);
});

for (const reimplemented of [false, true]) test(`derived newslot changes interface mapping only with reimplementation (${reimplemented})`, () => {
  const assembly = dispatchFixture([
    iface('IBase', [constant('Value', 1)]),
    {name: 'Base', methods: [ctor(), constant('Value', 2, 0x1e6)]},
    {name: 'Derived', base: 'Base', methods: [ctor('Base'), constant('Value', 7, 0x1e6)]}
  ], invoke('Derived', 'IBase::Value'),
  {interfaces: [['Base', 'IBase'], ...(reimplemented ? [['Derived', 'IBase']] : [])]});
  assert.equal(run(assembly), reimplemented ? 7 : 2);
});

test('a more-specific abstract declaration suppresses an inherited default implementation', () => {
  const assembly = dispatchFixture([
    iface('IBase', [constant('Value', 1)]),
    iface('ILeaf', [{name: 'Reabstract', flags: 0x5c1}]),
    {name: 'Impl', methods: [ctor()]}
  ], invoke('Impl', 'IBase::Value'), {interfaces: [['ILeaf', 'IBase'], ['Impl', 'ILeaf']],
    methodImpl: [['ILeaf', 'ILeaf::Reabstract', 'IBase::Value']]});
  const report = verifyCilAssembly(assembly);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_DISPATCH'));
});

test('interface maps reference the existing slot vector and survive snapshot replay', () => {
  const vm = new CilVirtualMachine(diamond('specific'));
  const owner = vm.inspector.types.find(type => type.name === 'Impl').token;
  const method = [...vm.inspector.methods.values()].find(method => method.owner === 'IBase' && method.name === 'Value');
  const expected = [...vm.inspector.methods.values()].find(method => method.name === 'LeafValue').token;
  const dispatch = vm.typeSystem.dispatch;
  const table = dispatch.table(owner);
  const index = dispatch.interfaceMaps.get(table).get(method.ownerToken).get(method.token);
  assert.equal(table.targets[index], expected);
  assert.equal(vm.typeSystem.table(owner).vtable.get(method.token), expected);
  const saved = vm.snapshot();
  assert.equal(vm.run().returnValue, 4);
  vm.restore(saved);
  assert.equal(vm.run().returnValue, 4);
  assert.equal(dispatch.resolve(owner, method.token), expected);
  const unrelated = vm.inspector.types.find(type => type.name === 'Program').token;
  assert.throws(() => dispatch.resolve(unrelated, method.token), /receiver is incompatible/);
});

for (const [kind, value, output] of [['class', 3, ''], ['derived', 2, '20\n'], ['base', 1, '10\n']]) {
  test('initialization runs only for the selected interface body: ' + kind, () => {
    const initializer = value => ({name: '.cctor', flags: 0x1891, result: 'void', body(writer, context) {
      const print = context.md.member(context.md.typeRef('System.Console'), 'WriteLine', methodSignature('void', ['int'], true));
      writer.op('ldc.i4', value).op('call', print).op('ret');
    }});
    const assembly = dispatchFixture([
      iface('IBase', [initializer(10), constant('Value', 1)]),
      iface('IDerived', [initializer(20), constant('Chosen', 2, 0x1e1)]),
      {name: 'Actual', methods: [ctor(), ...(kind === 'class' ? [constant('Chosen', 3, 0x1e1)] : [])]}
    ], (writer, context) => writer.op('newobj', context.methods.get('Actual::.ctor')).op('stloc.0')
      .op('ldloc.0').op('callvirt', context.methodRef('IBase::Value')).op('pop')
      .op('ldloc.0').op('callvirt', context.methodRef('IBase::Value')).op('ret'), {
      interfaces: [['IDerived', 'IBase'], ['Actual', kind === 'base' ? 'IBase' : 'IDerived']],
      methodImpl: [['IDerived', 'IDerived::Chosen', 'IBase::Value'],
        ...(kind === 'class' ? [['Actual', 'Actual::Chosen', 'IBase::Value']] : [])]
    });
    const result = new CilVirtualMachine(assembly).run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, value);
    assert.equal(result.output, output);
  });
}
