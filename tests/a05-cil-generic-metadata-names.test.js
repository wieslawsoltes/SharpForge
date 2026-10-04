import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, codedIndex, genericTypeParts, normalizeCallType, verifyCilAssembly} from '@sharpforge/cil';
import {ManagedHeap} from '@sharpforge/runtime';
import {MethodTableRegistry, runtimeTypeName} from '../packages/runtime/src/execution/method-table.js';
import {CilTypeSystem} from '../packages/runtime/src/execution/type-system.js';
import {verifyGenericType} from '../packages/cil/src/generic-profile.js';
import {genericMachineFixture} from './fixtures/cil-async/generic-machine-fixture.mjs';
import {managedFixture} from './managed-fixtures.js';

// These shapes are present in the retained Roslyn Debug and Release images. The metadata below
// is independently authored so malformed arity/VAR controls do not depend on a C# emitter.
const shapes = [
  {typeName: '<Keep>d__0`1', genericArity: 1, owners: [{name: 'Program', arity: 0, token: 0x02000002}]},
  {typeName: '<Read>d__1', genericArity: 1, owners: [{name: 'Holder`1', arity: 1}]},
  {typeName: '<First>d__0', genericArity: 2, owners: [{name: 'Outer`1', arity: 1}, {name: 'Inner`1', arity: 2}]},
];
const nameOf = shape => 'Fixture.' + [...shape.owners.map(owner => owner.name), shape.typeName].join('+');

for (const shape of shapes) {
  const name = nameOf(shape);
  test('CIL generic display names retain the complete metadata owner: ' + name, () => {
    const arguments_ = shape.genericArity === 1 ? ['System.Int32'] : ['System.Int32', 'System.String'];
    assert.deepEqual(genericTypeParts(name), {definition: name, arguments: []});
    assert.deepEqual(genericTypeParts(name + '<' + arguments_.join(', ') + '>'), {definition: name, arguments: arguments_});
    assert.equal(normalizeCallType(name + '<' + arguments_.join(', ') + '>[]&'),
      name + '<' + (shape.genericArity === 1 ? 'int' : 'int,string') + '>[]&');
  });

  test('CIL callback admission retains generated generic names and inherited arity: ' + name, () => {
    const report = verifyCilAssembly(genericMachineFixture(shape));
    assert.equal(report.success, true, JSON.stringify(report.issues));
  });

  test('CIL generated machine names do not bypass argument or VAR bounds: ' + name, () => {
    for (const options of [{wrongArity: true}, {outOfRangeVariable: true}]) {
      const report = verifyCilAssembly(genericMachineFixture({...shape, ...options}));
      assert.equal(report.success, false, JSON.stringify(options));
      assert.ok(report.issues.some(issue => issue.methodToken === (options.wrongArity ? 0x06000001 : 0x06000002)),
        JSON.stringify(report.issues));
    }
  });

  test('CIL inherited generic owners require a complete storage instantiation: ' + name, () => {
    const inspector = new AssemblyInspector(genericMachineFixture(shape));
    assert.throws(() => verifyGenericType(inspector, name, {typeArguments: [], methodArguments: []}), /Open generic storage/);
  });

  test('CIL method tables take total owner arity from GenericParam metadata: ' + name, () => {
    const inspector = new AssemblyInspector(genericMachineFixture(shape));
    const system = new CilTypeSystem({inspector, heap: new ManagedHeap()});
    const definition = system.table(0x02000003);
    assert.equal(definition.name, name);
    assert.equal(definition.genericArity, shape.genericArity);
    assert.equal(definition.flags.genericDefinition, true);
    const instance = system.table(name + (shape.genericArity === 1 ? '<int>' : '<int,string>'));
    assert.equal(instance.genericDefinition, definition);
    assert.equal(instance.definitionToken, definition.token);
    assert.equal(instance.containsGenericParameters, false);
    assert.equal(instance.typeArguments.length, shape.genericArity);
    assert.throws(() => system.table(name + '<int,string,bool>'), /argument count/);
  });
}

test('CIL display parsing separates only the trailing argument list and retains opaque names', () => {
  const argument = 'Fixture.Program+<Keep>d__0`1<System.Int32[, ]>';
  assert.deepEqual(genericTypeParts('Box`2<' + argument + ', System.String[]>'),
    {definition: 'Box`2', arguments: [argument, 'System.String[]']});
  for (const name of ['<Module>', '<>State', 'Fixture.Program+<Main>d__0', '<>Cell(System.Int32)']) {
    assert.deepEqual(genericTypeParts(name), {definition: name, arguments: []});
    assert.equal(normalizeCallType(name), name);
  }
});

test('runtime generated metadata owners preserve closed field substitutions and generic identity', () => {
  const name = 'Fixture.Outer`1+Inner`1+<Read>d__0';
  const registry = new MethodTableRegistry();
  registry.define({name, token: 0x02000001, genericArity: 2,
    fields: [{name: 'First', type: '!0'}, {name: 'Second', type: '!1'}]});
  const table = registry.get(name + '<int,string>');
  assert.equal(table.name, name + '<System.Int32, System.String>');
  assert.equal(table, registry.get(name + '<System.Int32,System.String>'));
  assert.deepEqual(table.fields.map(field => field.type.name), ['System.Int32', 'System.String']);
  assert.deepEqual(table.gcBitmap, [false, true]);
  assert.equal(table.genericArity, 2);
  assert.equal(registry.get(name + '<!0,!1>').containsGenericParameters, true);
  assert.throws(() => registry.get(name + '<int>'), /argument count/);
});

test('ordinary runtime generic aliases and malformed delimiters retain their existing behavior', () => {
  const registry = new MethodTableRegistry();
  assert.equal(registry.get('List<int>'), registry.get('System.Collections.Generic.List`1<System.Int32>'));
  assert.equal(registry.get('List<>'), registry.get('System.Collections.Generic.List`1'));
  for (const name of ['List<int', 'List<int>>', 'List<int[,>', 'int[']) {
    assert.throws(() => runtimeTypeName(name), /Unbalanced/);
  }
  assert.throws(() => registry.get('List<int,string>'), /argument count/);
});

for (const name of ['<Generated>', '<System.Int32>']) {
  test('exact declared metadata names take precedence over angle-suffix interpretation: ' + name, () => {
    const bytes = managedFixture({methods: [{name: 'Main',
      locals: [{kind: 'class', token: 0x02000003}], body: writer => writer.op('ret')}], decorate({md}) {
      md.add(2, [0x100003, md.string(name), 0, codedIndex('TypeDefOrRef', md.typeRef('System.Object')), 1, 2]);
      md.add(41, [3, 2]);
    }});
    const inspector = new AssemblyInspector(bytes);
    const declared = 'Fixture.Program+' + name;
    assert.doesNotThrow(() => verifyGenericType(inspector, declared, {typeArguments: [], methodArguments: []}));
    assert.doesNotThrow(() => verifyGenericType(inspector, declared + '[]', {typeArguments: [], methodArguments: []}));
    const report = verifyCilAssembly(inspector);
    assert.equal(report.success, true, JSON.stringify(report.issues));
    const registry = new MethodTableRegistry().define({name: declared, token: 0x02000003, genericArity: 0});
    assert.equal(registry.get(declared).name, declared);
  });
}

test('generic definition inventory belongs to the inspector and does not populate its method-body cache', () => {
  const inspector = new AssemblyInspector(genericMachineFixture(shapes[2]));
  const before = inspector.cache.size;
  const name = nameOf(shapes[2]);
  const context = {typeArguments: [], methodArguments: []};
  assert.doesNotThrow(() => verifyGenericType(inspector, name + '<int,string>', context));
  const inventory = inspector.genericTypeInventory;
  assert.ok(inventory instanceof Map);
  assert.doesNotThrow(() => verifyGenericType(inspector, name + '<string,int>', context));
  assert.equal(inspector.genericTypeInventory, inventory);
  assert.equal(inspector.cache.size, before);
  const other = new AssemblyInspector(genericMachineFixture(shapes[2]));
  assert.doesNotThrow(() => verifyGenericType(other, name + '<int,string>', context));
  assert.notEqual(other.genericTypeInventory, inventory);
});

test('generic definition inventory counts authoritative owner tokens independently of array ordering', () => {
  const owner = {token: 0x02000007, name: 'Owner`1+Inner'};
  const other = {token: 0x02000003, name: 'Other'};
  const inspector = {types: [owner, other], genericTypeInventory: null, metadata: {rows: []}};
  inspector.metadata.rows[42] = [[0, 0, codedIndex('TypeOrMethodDef', owner.token), 0],
    [1, 0, codedIndex('TypeOrMethodDef', owner.token), 0]];
  const context = {typeArguments: [], methodArguments: []};
  assert.doesNotThrow(() => verifyGenericType(inspector, 'Owner`1+Inner<int,string>', context));
  assert.throws(() => verifyGenericType(inspector, 'Owner`1+Inner<int>', context), /argument count/);
  assert.throws(() => verifyGenericType(inspector, 'Owner`1+Inner', context), /Open generic storage/);
  assert.doesNotThrow(() => verifyGenericType(inspector, 'Other', context));
});
