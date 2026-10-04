import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, emitAssembly, loadAssembly} from '@sharpforge/cil';
import {projectLibrary} from './support/project-assembly-fixtures.js';

const accessKinds = ['private', 'privateProtected', 'internal', 'protected', 'protectedInternal', 'public'];

function fixture() {
  const properties = accessKinds.map((access, index) => 'public int P' + index + ' { get; set; }').join(' ');
  return projectLibrary('Properties', 'public class Values { ' + properties + ' }').image;
}

function assertProperties(bytes) {
  const inspector = new AssemblyInspector(bytes);
  assert.equal(inspector.metadata.rows[23].length, accessKinds.length);
  const loaded = loadAssembly(bytes);
  const type = loaded.types.find(type => type.name === 'Values');
  assert.equal(type.properties.length, accessKinds.length);
  for (const [index, access] of accessKinds.entries()) {
    const property = type.properties.find(property => property.name === 'P' + index);
    assert.equal(property.access, access);
    for (const kind of ['get', 'set']) {
      const method = loaded.methods[property[kind]];
      assert.equal(method.accessor.access, access);
      assert.equal(inspector.methods.get(loaded.il.methodTokens[method.id]).flags & 7, index + 1);
    }
  }
}

test('canonical property reconstruction preserves all six accessor access kinds without a member override', () => {
  const image = fixture();
  for (const type of image.types) for (const property of type.properties ?? []) {
    property.access = accessKinds[Number(property.name.slice(1))];
    for (const kind of ['get', 'set']) image.methods[property[kind]].accessor.access = property.access;
  }
  assertProperties(emitAssembly(image, {name: 'Properties'}));
});

test('explicit accessor member overrides retain actual flags in debug metadata and canonical replay', () => {
  const image = fixture();
  const before = structuredClone(image);
  const memberDefinitions = {version: 1,
    methods: image.methods.map(method => ({id: method.id, access: method.accessor
      ? accessKinds[Number(method.accessor.property.slice(1))] : 'public'})),
    fields: image.types.flatMap(type => type.fields.map(field => ({type: type.id, index: field.index,
      access: 'private', isReadOnly: false}))),
    statics: image.statics.map((field, index) => ({index, access: 'private', isReadOnly: false})),
  };
  assertProperties(emitAssembly(image, {name: 'Properties', memberDefinitions}));
  assert.deepEqual(image, before);
  memberDefinitions.methods.find(method => method.access === 'privateProtected').access = 'unknown-access';
  assert.throws(() => emitAssembly(image, {memberDefinitions}), /Invalid member definitions/);
});
