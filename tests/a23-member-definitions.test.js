import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, emitAssembly, loadAssembly} from '@sharpforge/cil';
import {projectLibrary} from './support/project-assembly-fixtures.js';

const accessKinds = ['private', 'privateProtected', 'internal', 'protected', 'protectedInternal', 'public'];

function memberFixture() {
  const methods = accessKinds.map((access, index) => 'public static int M' + index + '() { return 42; }').join(' ');
  const fields = accessKinds.map((access, index) => 'public int F' + index + ';').join(' ');
  const {image} = projectLibrary('Visibility', 'public class Api { public Api() { } '
    + 'public static int StaticValue; ' + fields + ' ' + methods + ' }');
  const profile = {version: 1,
    methods: image.methods.map(method => ({id: method.id, access: method.name.startsWith('M')
      ? accessKinds[Number(method.name.slice(1))] : 'internal'})),
    fields: image.types.flatMap(type => type.fields.map(field => ({type: type.id, index: field.index,
      access: accessKinds[field.index], isReadOnly: field.index === 0}))),
    statics: image.statics.map((field, index) => ({index, access: 'internal', isReadOnly: true}))};
  return {image, profile};
}

test('explicit member metadata preserves all six access kinds, ctor visibility and readonly flags in canonical PEs', t => {
  const {image, profile} = memberFixture();
  const before = structuredClone(profile);
  const bytes = emitAssembly(image, {name: 'Visibility', memberDefinitions: profile});
  assert.deepEqual(profile, before, 'Emission does not modify the source member projection');
  const inspector = new AssemblyInspector(bytes);
  const type = inspector.types.find(type => type.name === 'Api');
  for (const [index] of accessKinds.entries()) {
    assert.equal(type.methods.find(method => method.name === 'M' + index).flags & 7, index + 1);
    assert.equal(type.fields.find(field => field.name === 'F' + index).flags & 7, index + 1);
  }
  const constructor = type.methods.find(method => method.name === '.ctor'
    && inspector.signature(method.token).parameters.length === 0);
  assert.equal(constructor.flags & 7, 3);
  assert.equal(type.fields.find(field => field.name === 'F0').flags & 0x20, 0x20);
  assert.equal(type.fields.find(field => field.name === 'StaticValue').flags & 0x37, 0x33);
  assert.deepEqual(inspector.debug.projectMetadata.memberDefinitions, profile);
  assert.equal(loadAssembly(bytes).methods.length, image.methods.length);
  t.diagnostic(JSON.stringify({fixture: 'Api with six method/field access kinds',
    legacyBytes: emitAssembly(image, {name: 'Visibility'}).length, memberMetadataBytes: bytes.length}));
});

test('member projection rejects missing, duplicate, unknown or out-of-range identities before emission', () => {
  const {image, profile} = memberFixture();
  const invalid = [
    value => { value.version = 2; },
    value => { value.methods.pop(); },
    value => { value.methods[1].id = value.methods[0].id; },
    value => { value.methods[0].access = 'friendly'; },
    value => { value.fields[0].type = image.types.length; },
    value => { value.fields[0].index = -1; },
    value => { value.fields[0].isReadOnly = 1; },
    value => { value.statics[0].index = image.statics.length; },
  ];
  for (const mutate of invalid) {
    const copy = structuredClone(profile);
    mutate(copy);
    assert.throws(() => emitAssembly(image, {memberDefinitions: copy}), /Invalid member definitions/);
  }
});

test('omitted member metadata retains the previous canonical public-member profile', () => {
  const {image} = memberFixture();
  const bytes = emitAssembly(image, {name: 'LegacyVisibility'});
  const inspector = new AssemblyInspector(bytes);
  assert.equal(inspector.debug.projectMetadata?.memberDefinitions, undefined);
  assert(inspector.types.find(type => type.name === 'Api').methods.filter(method => /^M\d$/.test(method.name))
    .every(method => (method.flags & 7) === 6));
  assert.equal(loadAssembly(bytes).methods.length, image.methods.length);
});
