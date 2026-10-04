import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AssemblyInspector, MetadataBuilder, readMetadata, encodeSignature, decodeSignature, codedIndex,
  readExecutionSignatureAst, signatureSlotType, verifyCilAssembly
} from '@sharpforge/cil';
import {genericCallFixture} from './support/generic-call-fixture.js';

const int = {kind: 'primitive', name: 'int'};
const method = (options = {}) => ({kind: 'method', hasThis: false, returnType: int, parameters: [int], ...options});
const pointer = (options = {}) => ({kind: 'functionPointer', signature: method(options)});

function fixture(type) {
  const tokens = {};
  const echo = method({hasThis: true, returnType: type, parameters: [type, int]});
  const field = {kind: 'field', type};
  const bytes = genericCallFixture([{name: 'Program', fields: [
    {name: 'Target', signature: encodeSignature(field)}
  ], methods: [
    {name: 'Main', result: 'void', localsSignature: encodeSignature({kind: 'locals', types: [type]}),
      body: writer => writer.op('ret')},
    {name: 'Echo', static: false, signature: encodeSignature(echo), body: writer => writer.op('ldarg.1').op('ret')},
    {name: 'Generic', genericParameters: [{}], body: writer => writer.op('ret')}
  ]}], {decorate(context) {
    tokens.method = context.methods.get('Program.Echo');
    tokens.field = context.fields.get('Program.Target');
    tokens.member = context.md.member(context.types.get('Program'), 'Echo', encodeSignature(echo));
    tokens.fieldMember = context.md.member(context.types.get('Program'), 'Target', encodeSignature(field));
    tokens.standalone = context.md.add(17, [context.md.blob(encodeSignature(echo))]);
    tokens.spec = context.md.add(43, [
      codedIndex('MethodDefOrRef', context.methods.get('Program.Generic')),
      context.md.blob(encodeSignature({kind: 'methodSpec', arguments: [type]}))
    ]);
  }});
  const inspector = new AssemblyInspector(bytes);
  tokens.locals = inspector.getMethod(inspector.pe.entryPoint).localSignature;
  return {inspector, tokens};
}

const variants = [
  ['static', {}], ['instance', {hasThis: true}], ['explicit', {hasThis: true, explicitThis: true}],
  ['unmanaged', {callingConvention: 1}], ['generic', {genericArity: 1}],
  ['vararg', {callingConvention: 5, sentinel: 0}]
];

for (const [name, options] of variants) test(`${name} fnptr header survives every metadata slot despite identical display text`, () => {
  const {inspector, tokens} = fixture(pointer(options));
  const read = token => readExecutionSignatureAst(inspector.metadata, token);
  const slots = [
    signatureSlotType(read(tokens.locals), 'local', 0),
    signatureSlotType(read(tokens.method), 'parameter', 0), signatureSlotType(read(tokens.method), 'return'),
    signatureSlotType(read(tokens.field), 'field'), signatureSlotType(read(tokens.fieldMember), 'field'),
    signatureSlotType(read(tokens.member), 'parameter', 0), signatureSlotType(read(tokens.standalone), 'return'),
    read(tokens.spec).arguments[0]
  ];
  const expected = decodeSignature(encodeSignature({kind: 'field', type: pointer(options)})).type;
  for (const slot of slots) {
    assert.deepEqual(slot, expected);
    assert.equal(Object.isFrozen(slot), true);
    assert.equal(Object.isFrozen(slot.signature), true);
    assert.equal(Object.isFrozen(slot.signature.parameters), true);
  }
  assert.equal(inspector.signature(tokens.locals).types[0], 'method int *(int)');
  assert.equal(inspector.signature(tokens.field).type, 'method int *(int)');
  assert.equal(inspector.signature(tokens.method).parameters[0], 'method int *(int)');
  assert.equal(inspector.signature(tokens.method).returnType, 'method int *(int)');
});

test('slot selection excludes implicit this and returns the original nested node without rewriting it', () => {
  const nested = pointer({hasThis: true, explicitThis: true});
  const type = pointer({returnType: nested, parameters: [{kind: 'byref', element: nested}]});
  const {inspector, tokens} = fixture(type);
  const ast = readExecutionSignatureAst(inspector.metadata, tokens.method);
  const selected = signatureSlotType(ast, 'parameter', 0);
  assert.equal(ast.hasThis, true);
  assert.equal(selected, ast.parameters[0]);
  assert.equal(signatureSlotType(ast, 'parameter', 1).name, 'int');
  assert.equal(selected.signature.parameters[0].kind, 'byref');
  assert.equal(selected.signature.parameters[0].element.signature.explicitThis, true);
  assert.equal(selected.signature.returnType.signature.hasThis, true);
  assert.throws(() => { selected.signature.returnType.signature.hasThis = false; }, TypeError);
  assert.throws(() => ast.parameters.push(int), TypeError);
  assert.deepEqual(encodeSignature(ast), inspector.metadata.blob(inspector.metadata.row(tokens.method)[4]));
});

test('custom modifiers and pinned locals stay attached to the selected raw type', () => {
  const type = {kind: 'modopt', token: 0x01000001, element: pointer({hasThis: true})};
  const builder = new MetadataBuilder('PinnedPointer');
  builder.typeRef('System.Runtime.CompilerServices.IsConst');
  const token = builder.add(17, [builder.blob(encodeSignature({kind: 'locals', types: [{kind: 'pinned', element: type}]}))]);
  const metadata = readMetadata(builder.finish());
  const selected = signatureSlotType(readExecutionSignatureAst(metadata, token), 'local', 0);
  assert.equal(selected.kind, 'pinned');
  assert.equal(selected.element.kind, 'modopt');
  assert.equal(selected.element.token, 0x01000001);
  assert.equal(selected.element.element.signature.hasThis, true);
  assert.equal(Object.isFrozen(selected.element), true);
});

test('fresh metadata readers and caller-held ASTs cannot alias rewritten signature bytes', () => {
  const left = fixture(pointer()), right = fixture(pointer({hasThis: true}));
  const old = readExecutionSignatureAst(left.inspector.metadata, left.tokens.locals);
  const other = readExecutionSignatureAst(right.inspector.metadata, right.tokens.locals);
  assert.equal(signatureSlotType(old, 'local', 0).signature.hasThis, false);
  assert.equal(signatureSlotType(other, 'local', 0).signature.hasThis, true);
  const raw = left.inspector.metadata.blob(left.inspector.metadata.row(left.tokens.locals)[0]);
  raw[3] |= 0x20; // locals header, count, FNPTR, then its method header.
  const updated = readExecutionSignatureAst(left.inspector.metadata, left.tokens.locals);
  assert.equal(signatureSlotType(updated, 'local', 0).signature.hasThis, true);
  assert.equal(signatureSlotType(old, 'local', 0).signature.hasThis, false);
});

test('token table, row, signature kind and slot selection fail explicitly', () => {
  const {inspector, tokens} = fixture(pointer());
  const metadata = inspector.metadata;
  for (const token of [null, '17', -1, 0, 1.5, 0x100000000, 0x11000000, 0x01000001, 0x70000001, 0x1100ffff]) {
    assert.throws(() => readExecutionSignatureAst(metadata, token), {name: 'CilError'});
  }
  const locals = readExecutionSignatureAst(metadata, tokens.locals);
  for (const index of [undefined, -1, 1, 1.5, '0', NaN]) {
    assert.throws(() => signatureSlotType(locals, 'local', index), /slot index/);
  }
  for (const kind of ['parameter', 'return', 'field', 'this', 'constructor']) {
    assert.throws(() => signatureSlotType(locals, kind, 0), /requested slot/);
  }
  const member = readExecutionSignatureAst(metadata, tokens.method);
  assert.throws(() => signatureSlotType(member, 'return', 0), /requested slot/);
  assert.throws(() => signatureSlotType(null, 'local', 0), /requested slot/);
  const broken = new MetadataBuilder('WrongSignature');
  const field = broken.add(4, [6, broken.string('Bad'), broken.blob(encodeSignature(method()))]);
  assert.throws(() => readExecutionSignatureAst(readMetadata(broken.finish()), field), /Signature kind/);
});

test('parser bounds, cancellation and malformed blob errors are preserved', () => {
  const {inspector, tokens} = fixture(pointer());
  const metadata = inspector.metadata;
  const controller = new AbortController();
  controller.abort();
  for (const options of [{maxDepth: 0}, {maxNodes: 1}, {signal: controller.signal}]) {
    const raw = metadata.blob(metadata.row(tokens.locals)[0]);
    let expected;
    try { decodeSignature(raw, options); } catch (error) { expected = error; }
    assert(expected, 'fixture must exercise an existing parser rejection');
    assert.throws(() => readExecutionSignatureAst(metadata, tokens.locals, options),
      {name: expected.name, message: expected.message});
  }
  for (const bytes of [[], [7, 1], [7, 1, 0x1b, 0x40, 0, 1], [7, 0, 0xff]]) {
    const builder = new MetadataBuilder('Malformed');
    const token = builder.add(17, [builder.blob(Uint8Array.from(bytes))]);
    assert.throws(() => readExecutionSignatureAst(readMetadata(builder.finish()), token), {name: 'CilError'});
  }
});

test('execution admits ordinary pointer locals and rejects unsupported raw headers before display projection', () => {
  assert.equal(verifyCilAssembly(fixture(pointer()).inspector).success, true);
  assert.equal(verifyCilAssembly(fixture(pointer({hasThis: true})).inspector).success, true);
  for (const [, options] of variants.slice(2)) {
    const report = verifyCilAssembly(fixture(pointer(options)).inspector);
    assert.equal(report.success, false);
    assert(report.issues.some(issue => ['IL_CALLI', 'IL_UNMANAGED'].includes(issue.code) &&
      issue.exceptionType === 'NotSupportedException'));
  }
  const nested = pointer({returnType: pointer({hasThis: true})});
  assert.equal(verifyCilAssembly(fixture(nested).inspector).success, false);
});
