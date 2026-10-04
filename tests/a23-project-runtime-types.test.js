import test from 'node:test';
import assert from 'node:assert/strict';
import {MethodTableRegistry, createSourceMethodTables, runtimeTypeName} from '../packages/runtime/src/execution/method-table.js';
import {simpleTypeName, fullTypeName, typeAssemblyIdentity, displayTypeName} from '../packages/runtime/src/execution/type-display.js';

const qualified = (assemblyKey, metadataName = 'Example.Widget') => ({
  name: '[' + assemblyKey + ']' + metadataName, assemblyKey, metadataName, base: 'System.Object'
});

test('registered project type identities remain opaque inside arrays and generic framework types', () => {
  const descriptor = qualified('Odd], <assembly>, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null');
  const registry = new MethodTableRegistry().define(descriptor);
  const type = registry.get(descriptor.name);
  assert.equal(type.metadataName, 'Example.Widget');
  assert.equal(type.assemblyKey, descriptor.assemblyKey);
  assert.equal(registry.get(descriptor.name + '[]').elementType, type);
  assert.equal(registry.get(descriptor.name + '[,]').rank, 2);
  assert.equal(registry.get(descriptor.name + '&').elementType, type);
  const list = registry.get('List<' + descriptor.name + '>');
  assert.equal(list.typeArguments[0], type);
  assert.equal(list.name, 'System.Collections.Generic.List`1<' + descriptor.name + '>');
  const dictionary = registry.get('Dictionary<string, List<' + descriptor.name + '[]>>');
  assert.equal(dictionary.typeArguments[1].typeArguments[0].elementType, type);
  assert.throws(() => registry.get(descriptor.name + '['), /Unbalanced|Invalid/);
  assert.throws(() => runtimeTypeName(descriptor.name), /Unbalanced|Invalid/);
});

test('same metadata type names from different assemblies have distinct tables and correct reflection display', () => {
  const left = qualified('Left, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null');
  const right = qualified('Right, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null');
  const registry = new MethodTableRegistry().define(left).define(right);
  const leftType = registry.get(left.name);
  const rightType = registry.get(right.name);
  assert.notEqual(leftType, rightType);
  assert.equal(simpleTypeName(leftType), 'Widget');
  assert.equal(fullTypeName({}, leftType), 'Example.Widget');
  assert.equal(typeAssemblyIdentity({}, rightType), right.assemblyKey);
  assert.equal(displayTypeName(registry.get(left.name + '[]')), 'Example.Widget[]');
  assert.equal(typeAssemblyIdentity({}, registry.get(right.name + '[,]')), right.assemblyKey);
  const generic = registry.get('List<' + left.name + '>');
  assert.equal(displayTypeName(generic), 'System.Collections.Generic.List`1[Example.Widget]');
  assert.equal(fullTypeName({}, generic), 'System.Collections.Generic.List`1[[Example.Widget, ' + left.assemblyKey + ']]');
});

test('source method tables retain assembly provenance and ordinary table identities', () => {
  const descriptor = qualified('Library, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null');
  const registry = createSourceMethodTables({types: [{...descriptor, id: 0, fields: []}],
    methods: [{id: 3, owner: descriptor.name, isStatic: false}, {id: 4, owner: descriptor.name, isStatic: true}]});
  assert.deepEqual([...registry.get(descriptor.name).vtable], [[3, 3]]);
  assert.equal(registry.get(descriptor.name).metadataName, descriptor.metadataName);
  assert.equal(registry.get('int').name, 'System.Int32');
  assert.equal(registry.get('string[]').elementType.name, 'System.String');
});

test('source runtime admission rejects unresolved images before constructing any method table', () => {
  let readTypes = false;
  const image = {externalReferences: {format: 'SharpForge.ProjectReferences/1'},
    get types() { readTypes = true; return []; }};
  assert.throws(() => createSourceMethodTables(image), error => error.code === 'SF_RUNTIME_DEPENDENCIES');
  assert.equal(readTypes, false);
  assert.throws(() => createSourceMethodTables({externalReferences: null}), /complete supplied SharpForge/);
});
