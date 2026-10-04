import test from 'node:test';
import assert from 'node:assert/strict';
import {emitAssembly, loadAssembly, loadProjectAssembly, sha256} from '@sharpforge/cil';
import {VirtualMachine} from '@sharpforge/runtime';
import {projectApplication, projectLibrary} from './support/project-assembly-fixtures.js';

const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const publicMembers = image => ({version: 1,
  methods: image.methods.map(method => ({id: method.id, access: 'public'})),
  fields: image.types.flatMap(type => type.fields.map(field => ({type: type.id, index: field.index,
    access: 'public', isReadOnly: false}))),
  statics: image.statics.map((field, index) => ({index, access: 'public', isReadOnly: false}))});

function artifacts({expression = 'Api.Answer()', restrict, friend = false, typeAccess = 'public'} = {}) {
  const library = projectLibrary('Library', 'public class Api { public Api() { } public static int Value; '
    + 'public static int Answer() { return 42; } public int Number() { return 42; } }');
  const application = projectApplication('System.Console.WriteLine(' + expression + ');', [library]);
  const memberDefinitions = publicMembers(library.image);
  restrict?.(memberDefinitions, library.image);
  const dependency = emitAssembly(library.image, {name: 'Library', memberDefinitions,
    typeDefinitions: {Api: {name: 'Api', namespace: '', access: typeAccess}},
    assemblyAttributes: friend ? [{type: 'System.Runtime.CompilerServices.InternalsVisibleToAttribute', value: 'App'}] : []});
  const image = structuredClone(application.image);
  image.externalReferences.assemblies[0].sha256 = hex(sha256(dependency));
  return {assembly: emitAssembly(image, {name: 'App'}), dependencies: [{assembly: dependency}]};
}

function denyMember(kind, access) {
  return (profile, image) => {
    if (kind === 'field') profile.statics.find(record => image.statics[record.index].name === 'Api.Value').access = access;
    else profile.methods.find(record => image.methods[record.id].name === (kind === 'ctor' ? '.ctor' : 'Answer')).access = access;
  };
}

test('actual project member flags prevent forged canonical references from bypassing visibility', () => {
  for (const access of ['private', 'privateProtected', 'internal', 'protected', 'protectedInternal']) {
    for (const [kind, expression] of [['method', 'Api.Answer()'], ['field', 'Api.Value'], ['ctor', 'new Api().Number()']]) {
      const {assembly, dependencies} = artifacts({expression, restrict: denyMember(kind, access)});
      assert(loadAssembly(assembly).externalReferences, 'A compiler may admit an unresolved intermediate PE');
      assert.throws(() => loadProjectAssembly(assembly, {dependencies}), error => error.code === 'PRJ0005'
        && /inaccessible project member/.test(error.message), kind + ' ' + access);
    }
  }
});

test('actual IVT attributes grant internal project access while keeping private members inaccessible', () => {
  for (const access of ['internal', 'protectedInternal']) {
    const {assembly, dependencies} = artifacts({friend: true, restrict: denyMember('method', access)});
    const graph = loadProjectAssembly(assembly, {dependencies});
    const result = new VirtualMachine(graph.image).run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '42\n');
  }
  const denied = artifacts({friend: true, restrict: denyMember('method', 'private')});
  assert.throws(() => loadProjectAssembly(denied.assembly, {dependencies: denied.dependencies}), {code: 'PRJ0005'});
});

test('actual TypeDef visibility is enforced independently from member visibility', () => {
  const hidden = artifacts({typeAccess: 'internal'});
  assert.throws(() => loadProjectAssembly(hidden.assembly, {dependencies: hidden.dependencies}), error => error.code === 'PRJ0005'
    && /inaccessible project type/.test(error.message));
  const friend = artifacts({typeAccess: 'internal', friend: true});
  assert.equal(new VirtualMachine(loadProjectAssembly(friend.assembly, {dependencies: friend.dependencies}).image).run().output, '42\n');
});

test('external writes to actual initonly fields are rejected even with friend access', () => {
  const {assembly, dependencies} = artifacts({expression: '(Api.Value = 42)', friend: true,
    restrict: (profile, image) => {
      profile.statics.find(record => image.statics[record.index].name === 'Api.Value').isReadOnly = true;
    }});
  assert.throws(() => loadProjectAssembly(assembly, {dependencies}), error => error.code === 'PRJ0005'
    && /initonly/.test(error.message));
});
