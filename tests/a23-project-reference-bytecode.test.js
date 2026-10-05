import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMAT_VERSION, Op, OpName, PROJECT_REFERENCE_FORMAT, projectReferenceLimits, projectAssemblyKey,
  verifyProjectReferences, verifyImage, serializeImage, deserializeImage,
} from '@sharpforge/bytecode';

function referenceProfile() {
  const identity = {name: 'Library', version: [1, 2, 3, 4], cultureName: '', publicKeyToken: '',
    isRetargetable: false, contentType: 'default'};
  const key = projectAssemblyKey(identity);
  return {
    format: PROJECT_REFERENCE_FORMAT,
    assemblies: [{identity, key, sha256: 'a'.repeat(64)}],
    types: [{assembly: 0, token: 0x02000001, name: 'Example.Counter', imageName: '[' + key + ']Example.Counter'}],
    methods: [
      {type: 0, token: 0x06000001, name: 'Make', isStatic: true, parameters: ['int'], returnType: 'int'},
      {type: 0, token: 0x06000002, name: 'Read', isStatic: false, parameters: [], returnType: 'int'},
      {type: 0, token: 0x06000003, name: '.ctor', isStatic: false, parameters: ['int'], returnType: 'void'},
    ],
    fields: [
      {type: 0, token: 0x04000001, name: 'Value', isStatic: false, fieldType: 'int'},
      {type: 0, token: 0x04000002, name: 'Count', isStatic: true, fieldType: 'int'},
    ],
  };
}

function bytecode(instructions, externalReferences = referenceProfile()) {
  return {
    formatVersion: FORMAT_VERSION,
    entryPoint: 0,
    constants: [null, 7],
    types: [],
    statics: [],
    sequencePoints: [],
    methods: [{id: 0, qualifiedName: 'Program.Main', parameters: [], isStatic: true, locals: [], handlers: [],
      code: Int32Array.from(instructions.flat())}],
    ...(externalReferences === undefined ? {} : {externalReferences}),
  };
}

test('A23 external instructions append stable opcode IDs without changing existing bytecode', () => {
  const previous = ['SEQ', 'CONST', 'LDLOC', 'STLOC', 'LDSTATIC', 'STSTATIC', 'LDFLD', 'STFLD', 'DUP', 'POP',
    'BINARY', 'UNARY', 'JUMP', 'JFALSE', 'JTRUE', 'CALL', 'BUILTIN', 'RET', 'NEWOBJ', 'NEWARR',
    'LDELEM', 'STELEM', 'LENGTH', 'THROW', 'RETHROW', 'CONVERT', 'NOP', 'ENDFINALLY', 'DELEGATE', 'ENUM'];
  assert.deepEqual(OpName.slice(0, 30), previous);
  previous.forEach((name, index) => assert.equal(Op[name], index));
  assert.deepEqual(OpName.slice(30), ['EXTCALL', 'EXTNEWOBJ', 'EXTLDFLD', 'EXTSTFLD', 'EXTLDSTATIC', 'EXTSTSTATIC']);
  assert.equal(Op.EXTSTSTATIC, 35);
  assert.equal(FORMAT_VERSION, 2);
  assert.ok(Object.isFrozen(Op) && Object.isFrozen(OpName) && Object.isFrozen(projectReferenceLimits));
});

test('A23 explicit assembly keys preserve full versions, identity flags and escaped names', () => {
  const identity = referenceProfile().assemblies[0].identity;
  assert.equal(projectAssemblyKey(identity), 'Library, Version=1.2.3.4, Culture=neutral, PublicKeyToken=null');
  assert.equal(projectAssemblyKey({...identity, name: 'A,B=Q'}), 'A\\,B\\=Q, Version=1.2.3.4, Culture=neutral, PublicKeyToken=null');
  assert.equal(projectAssemblyKey({...identity, isRetargetable: true, contentType: 'windowsRuntime',
    publicKeyToken: '0123456789abcdef'}),
  'Library, Version=1.2.3.4, Culture=neutral, PublicKeyToken=0123456789abcdef, Retargetable=Yes, ContentType=WindowsRuntime');
  for (const patch of [{version: [1]}, {version: [-1, 0, 0, 0]}, {version: [65536, 0, 0, 0]},
    {name: ''}, {name: 'bad\0name'}, {publicKeyToken: 'ABCDEF0123456789'}, {isRetargetable: 0}, {contentType: 'unknown'}]) {
    assert.throws(() => projectAssemblyKey({...identity, ...patch}), /identity/);
  }
});

test('A23 well-formed unlinked project references verify and survive bytecode serialization', () => {
  const references = referenceProfile();
  assert.deepEqual(verifyProjectReferences(references), []);
  const image = bytecode([[Op.CONST, 1, 0], [Op.EXTCALL, 0, 1], [Op.RET, 0, 0]], references);
  assert.deepEqual(verifyImage(image), []);
  assert.deepEqual(deserializeImage(serializeImage(image)), image);
  const ordinary = bytecode([[Op.CONST, 1, 0], [Op.RET, 0, 0]]);
  delete ordinary.externalReferences;
  assert.deepEqual(verifyImage(ordinary), []);
  assert.deepEqual(deserializeImage(serializeImage(ordinary)), ordinary);
});

test('A23 external call, allocation, field and static-store stack effects retain expression results', () => {
  const constant = [Op.CONST, 1, 0];
  const receiver = [Op.CONST, 0, 0];
  const programs = [
    [constant, [Op.EXTCALL, 0, 1]],
    [receiver, [Op.EXTCALL, 1, 1]],
    [constant, [Op.EXTNEWOBJ, 2, 1]],
    [receiver, [Op.EXTLDFLD, 0, 0]],
    [receiver, constant, [Op.EXTSTFLD, 0, 0]],
    [[Op.EXTLDSTATIC, 1, 0]],
    [constant, [Op.EXTSTSTATIC, 1, 0]],
  ];
  for (const instructions of programs) {
    const image = bytecode([...instructions, [Op.RET, 0, 0]]);
    assert.deepEqual(verifyImage(image), [], JSON.stringify(instructions));
  }
});

test('A23 external operands reject missing profiles, incorrect arity, access modes and stack underflow', () => {
  const constant = [Op.CONST, 1, 0];
  const cases = [
    [[Op.EXTCALL, 0, 1], /Stack underflow/],
    [[Op.EXTCALL, 0, 0], /argument count/],
    [[Op.EXTCALL, 0, -1], /argument count/],
    [[Op.EXTNEWOBJ, 0, 1], /constructor/],
    [[Op.EXTNEWOBJ, 2, 2], /argument count/],
    [[Op.EXTCALL, 99, 0], /external method/],
    [[Op.EXTCALL, -1, 0], /reference operand/],
    [[Op.EXTLDFLD, 1, 0], /access mode/],
    [[Op.EXTLDSTATIC, 0, 0], /access mode/],
    [[Op.EXTLDSTATIC, 1, 1], /external field/],
    [[Op.EXTSTFLD, 0, 0], /Stack underflow/],
  ];
  for (const [instruction, pattern] of cases) {
    assert.match(verifyImage(bytecode([instruction, [Op.RET, 0, 0]])).join('\n'), pattern);
  }
  for (const instruction of [[Op.EXTCALL, 0, 1], [Op.EXTNEWOBJ, 2, 1], [Op.EXTLDFLD, 0, 0],
    [Op.EXTSTFLD, 0, 0], [Op.EXTLDSTATIC, 1, 0], [Op.EXTSTSTATIC, 1, 0]]) {
    const image = bytecode([constant, instruction, [Op.RET, 0, 0]]);
    delete image.externalReferences;
    assert.match(verifyImage(image).join('\n'), /external/);
  }
});

test('A23 descriptor validation rejects malformed identities, tokens, signatures and duplicate definitions', () => {
  const changes = [
    references => { references.format = 'SharpForge.ProjectReferences/2'; },
    references => { references.assemblies[0].sha256 = 'A'.repeat(64); },
    references => { references.assemblies[0].key = 'Library'; },
    references => { references.assemblies[0].identity.version = [1, 0, 0]; },
    references => { references.assemblies.push(structuredClone(references.assemblies[0])); },
    references => { references.types[0].assembly = -1; },
    references => { references.types[0].token = 0x02000000; },
    references => { references.types[0].token = 0x04000001; },
    references => { references.types[0].imageName = 'Example.Counter'; },
    references => { references.types[0].name = Object.create(null); },
    references => { references.types.push(structuredClone(references.types[0])); },
    references => { references.methods[0].type = 99; },
    references => { references.methods[0].token = 0x04000001; },
    references => { references.methods[0].isStatic = 1; },
    references => { references.methods[0].returnType = ''; },
    references => { references.methods[0].parameters = ['bad\0name']; },
    references => { references.methods[0].parameters = new Array(1025).fill('int'); },
    references => { references.methods[2].isStatic = true; },
    references => { references.fields[0].fieldType = ''; },
    references => { references.fields.push(structuredClone(references.fields[0])); },
  ];
  for (const change of changes) {
    const references = referenceProfile();
    change(references);
    assert.ok(verifyProjectReferences(references).length, String(change));
    assert.ok(verifyImage(bytecode([[Op.CONST, 1, 0], [Op.RET, 0, 0]], references)).length, String(change));
  }
  for (const value of [null, undefined, 1, [], {}]) assert.ok(verifyProjectReferences(value).length);
});

test('A23 external descriptor limits bound sparse tables, metadata text and error collection', () => {
  for (const table of ['assemblies', 'types', 'methods', 'fields']) {
    const references = referenceProfile();
    references[table] = new Array(projectReferenceLimits[table] + 1);
    assert.match(verifyProjectReferences(references).join('\n'), new RegExp('oversized ' + table));
  }
  const references = referenceProfile();
  const key = references.assemblies[0].key;
  references.methods = [];
  references.fields = [];
  references.types = Array.from({length: 1200}, (_, index) => {
    const name = 'N' + index + 'x'.repeat(3890);
    return {assembly: 0, token: 0x02000001 + index, name, imageName: '[' + key + ']' + name};
  });
  assert.match(verifyProjectReferences(references).join('\n'), /metadata text exceeds 16 MiB/);
  references.types = new Array(1000);
  assert.equal(verifyProjectReferences(references).length, 100);
});
