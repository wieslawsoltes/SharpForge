import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {FORMAT_VERSION, Op, PROJECT_REFERENCE_FORMAT, projectAssemblyKey} from '@sharpforge/bytecode';
import {AssemblyInspector, emitAssembly, loadAssembly, decodeCoded, sha256} from '@sharpforge/cil';

function referenceFixture() {
  const source = 'public class Counter { public int Value; public static int Count; '
    + 'public Counter(int value) { Value = value; } public int Read() { return Value; } }';
  const library = compileToIL(source, {name: 'MetadataLibrary', outputKind: 'library', assemblyVersion: '1.2.3.4'});
  assert.equal(library.success, true, JSON.stringify(library.diagnostics));
  const inspector = new AssemblyInspector(library.assembly);
  const type = inspector.types.find(type => type.name === 'Counter');
  const constructor = type.methods.find(method => method.name === '.ctor'
    && inspector.signature(method.token).parameters[0] === 'int');
  const read = type.methods.find(method => method.name === 'Read');
  const identity = {name: 'MetadataLibrary', version: [1, 2, 3, 4], cultureName: '', publicKeyToken: '',
    isRetargetable: false, contentType: 'default'};
  const key = projectAssemblyKey(identity);
  const profile = {
    format: PROJECT_REFERENCE_FORMAT,
    assemblies: [{identity, key, sha256: Buffer.from(sha256(library.assembly)).toString('hex')}],
    types: [{assembly: 0, token: type.token, name: 'Counter', imageName: '[' + key + ']Counter'}],
    methods: [
      {type: 0, token: constructor.token, name: '.ctor', isStatic: false, parameters: ['int'], returnType: 'void'},
      {type: 0, token: read.token, name: 'Read', isStatic: false, parameters: [], returnType: 'int'},
    ],
    fields: type.fields.map(field => ({type: 0, token: field.token, name: field.name,
      isStatic: field.isStatic, fieldType: inspector.signature(field.token).type})),
  };
  return {profile, instanceField: profile.fields.findIndex(field => !field.isStatic),
    staticField: profile.fields.findIndex(field => field.isStatic)};
}

function consumer(fixture) {
  const {profile, instanceField, staticField} = fixture;
  const code = [
    [Op.CONST, 0, 0], [Op.EXTNEWOBJ, 0, 1], [Op.STLOC, 0, 0], [Op.POP, 0, 0],
    [Op.LDLOC, 0, 0], [Op.EXTLDFLD, instanceField, 0], [Op.POP, 0, 0],
    [Op.LDLOC, 0, 0], [Op.CONST, 0, 0], [Op.EXTSTFLD, instanceField, 0], [Op.POP, 0, 0],
    [Op.EXTLDSTATIC, staticField, 0], [Op.POP, 0, 0],
    [Op.CONST, 0, 0], [Op.EXTSTSTATIC, staticField, 0], [Op.POP, 0, 0],
    [Op.LDLOC, 0, 0], [Op.EXTCALL, 1, 1], [Op.RET, 0, 0],
  ];
  return {formatVersion: FORMAT_VERSION, name: 'MetadataConsumer', entryPoint: 0,
    constants: [42], types: [], statics: [], sources: [], sequencePoints: [], externalReferences: profile,
    methods: [{id: 0, name: 'Main', qualifiedName: 'Program.Main', owner: null, isStatic: true,
      parameters: [], returnType: 'int', locals: [{slot: 0, name: 'value', type: profile.types[0].imageName}],
      handlers: [], code: Int32Array.from(code.flat())}]};
}

test('public CIL emission writes scoped references and round-trips all six external operations without a compiler consumer', () => {
  const fixture = referenceFixture();
  const image = consumer(fixture);
  const bytes = emitAssembly(image);
  const inspector = new AssemblyInspector(bytes);
  const metadata = inspector.metadata;
  const tokens = inspector.debug.referenceTokens;
  const reference = metadata.row(tokens.assemblies[0]);
  assert.equal(metadata.string(reference[6]), 'MetadataLibrary');
  assert.deepEqual(reference.slice(0, 4), [1, 2, 3, 4]);
  assert.equal(decodeCoded('ResolutionScope', metadata.row(tokens.types[0])[0]), tokens.assemblies[0]);
  assert.equal(metadata.typeName(tokens.types[0]), 'Counter');
  assert(!inspector.types.some(type => type.name === 'Counter'), 'The dependency has no copied TypeDef in the consumer');
  for (const member of [...tokens.methods, ...tokens.fields]) {
    assert.equal(member >>> 24, 10);
    assert.equal(decodeCoded('MemberRefParent', metadata.row(member)[0]), tokens.types[0]);
  }
  const loaded = loadAssembly(bytes);
  assert.deepEqual(loaded.externalReferences, fixture.profile);
  assert.deepEqual(loaded.methods[0].code, image.methods[0].code);
  assert.equal(loaded.methods[0].locals[0].type, fixture.profile.types[0].imageName);
  assert.deepEqual(emitAssembly(loaded), bytes, 'Canonical unlinked replay retains the exact metadata and CIL');
});

test('public CIL emission rejects invalid external field modes and descriptor tokens before producing bytes', () => {
  const fixture = referenceFixture();
  const wrongMode = consumer(fixture);
  wrongMode.externalReferences.fields[fixture.instanceField].isStatic = true;
  assert.throws(() => emitAssembly(wrongMode), /Invalid compiler image.*access mode/);
  const invalidToken = consumer(referenceFixture());
  invalidToken.externalReferences.methods[0].token = 0x04000001;
  assert.throws(() => emitAssembly(invalidToken), /Invalid compiler image/);
});
