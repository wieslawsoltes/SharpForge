import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCilMethodTypes } from '@sharpforge/cil';
import { objectCases } from './fixtures/verifier-object-model/cases.js';
import { objectCase, prepareObject, verifyObject } from './helpers/object-verifier.js';

const diagnostic = report => report.diagnostics[0]?.diagnostic;

test('nominal construction, casts and boxing use canonical metadata and retain exact rejected or unknown reasons', () => {
  for (const fixture of objectCases) {
    const report = verifyObject(fixture);
    assert.equal(report.status, fixture.status, JSON.stringify({ name: fixture.name, report }));
    assert.equal(report.profile, 'SharpForge.TypedCIL.Objects/1', fixture.name);
    if (fixture.diagnostic) assert.equal(diagnostic(report), fixture.diagnostic, fixture.name);
  }
});

test('constructor contract validates name, staticness, metadata flags, return and implementation before transfers', () => {
  const fixture = objectCase('NewClass');
  for (const flags of [0x86, 0x886, 0x1086, 0x1c86]) {
    const report = verifyObject({ ...fixture, constructor: { owner: 'Owner', flags } });
    assert.equal(report.status, 'rejected', String(flags));
    assert.equal(diagnostic(report), 'CtorSig', String(flags));
  }
  const staticConstructor = { ...fixture, constructor: { owner: 'Owner', flags: 0x1896, instance: false } };
  assert.equal(diagnostic(verifyObject(staticConstructor)), 'CtorSig');
  assert.equal(diagnostic(verifyObject({ ...fixture, constructor: { owner: 'Owner', result: 'int' } })), 'CtorSig');
  for (const constructor of [{ owner: 'Owner', implFlags: 3 }, { owner: 'Owner', noBody: true }]) {
    const report = verifyObject({ ...fixture, constructor });
    assert.equal(report.status, 'unknown');
    assert.equal(diagnostic(report), 'ConstructorImplementationUnavailable');
  }
  for (const modifier of [0x1f, 0x20]) {
    const constructor = { owner: 'Owner', signature: Uint8Array.of(0x20, 0, modifier, 8, 1) };
    const report = verifyObject({ ...fixture, constructor });
    assert.equal(report.status, 'unknown');
    assert.equal(diagnostic(report), 'ConstructorSignatureUnavailable');
  }
});

test('object operands validate token kinds and extents including unreachable instructions', () => {
  for (const [opcode, tokens, code] of [
    ['castclass', [0x02000000, 0x0200ffff, 0x04000001, 0x06000001], 'CILVT0001'],
    ['newobj', [0x06000000, 0x0600ffff, 0x02000002], 'CILVM0001'],
  ]) {
    for (const token of tokens) {
      const report = verifyObject({ name: 'UnreachableOperand', body: writer => writer.op('ret').op(opcode, token).op('pop').op('ret') });
      assert.equal(report.status, 'rejected', JSON.stringify({ opcode, token, report }));
      assert.equal(report.diagnostics[0].code, code);
      assert.equal(report.diagnostics[0].offset, 1);
    }
  }
});

test('local TypeRef aliases reuse the same nominal operand identity and retain private-type access checks', () => {
  const fixture = { name: 'LocalTypeAlias', parameters: ['valuetype Fixture.Value'], result: 'object',
    decorate(input) {
      input.alias = input.builder.addRow('TypeRef', { ResolutionScope: 1, Name: 'Value', Namespace: 'Fixture' });
    },
    body(writer, input) { writer.op('ldarg.0').op('box', input.alias).op('ret'); } };
  assert.equal(verifyObject(fixture).status, 'verified');
  const privateConstructor = { ...objectCase('NewClass'), body(writer, input) {
    writer.op('newobj', input.constructors.Hidden).op('pop').op('ldnull').op('ret');
  } };
  assert.equal(diagnostic(verifyObject(privateConstructor)), 'TypeAccess');
});

test('repeated local constructors share a proved ordinary base path without losing their declared result type', () => {
  const fixture = { name: 'SharedConstructorPath', constructor: { owner: 'Derived' }, result: 'class Fixture.Owner',
    body(writer, input) {
      for (let index = 0; index < 32; index++) {
        writer.op('newobj', input.constructors.Derived).op('pop');
        writer.op('newobj', input.constructors.Owner).op('pop');
      }
      writer.op('newobj', input.constructors.Derived).op('ret');
    } };
  assert.equal(verifyObject(fixture).status, 'verified');
  assert.equal(verifyObject({ ...fixture, result: 'class Fixture.Other' }).diagnostics[0].diagnostic, 'StackUnexpected');
});

test('constructor caller checks preserve missing authority, generic, byref-return and constructor-body boundaries', () => {
  const prepared = prepareObject(objectCase('NewClass'));
  assert.equal(verifyCilMethodTypes(prepared.inspector, prepared.input.method).status, 'unknown');
  for (const sameModule of [true, undefined]) {
    const options = { ...prepared.options, coreTypes: { ...prepared.options.coreTypes, sameModule } };
    const report = verifyCilMethodTypes(prepared.inspector, prepared.input.method, options);
    assert.equal(report.status, 'unknown');
    assert.equal(diagnostic(report), 'ConstructorBaseUnavailable');
  }
  const generic = { ...objectCase('NewClass'), decorate(input) {
    input.builder.addRow('GenericParam', { Number: 0, Flags: 0, Owner: input.types.Owner, Name: 'T' });
  } };
  assert.equal(verifyObject(generic).status, 'unknown');
  const byref = { ...objectCase('UnboxFieldRead'), result: 'valuetype Fixture.Value&' };
  assert.equal(diagnostic(verifyObject(byref)), 'UnsupportedSignature');
  const constructorBody = { name: 'ConstructorBody', methodName: '.ctor', instance: true, flags: 0x1886,
    body: writer => writer.op('ret') };
  assert.equal(diagnostic(verifyObject(constructorBody)), 'ConstructorStateUnavailable');
  const explicitLayout = { ...objectCase('BoxValue'), decorate(input) {
    const row = input.builder.rows[2][(input.types.Value & 0xffffff) - 1];
    row[0] = (row[0] & ~0x18) | 0x10;
  } };
  assert.equal(diagnostic(verifyObject(explicitLayout)), 'ExplicitLayoutUnavailable');
});

test('new object results compose local initialization, stack limits and exact failing IL offsets', () => {
  const fixture = { ...objectCase('NewClass'), locals: ['class Fixture.Owner'], initLocals: false, body(writer, input) {
    writer.op('newobj', input.constructors.Owner).op('stloc.0').op('ldloc.0').op('ret');
  } };
  assert.equal(diagnostic(verifyObject(fixture)), 'InitLocals');
  assert.equal(verifyObject(fixture, { localInitialization: 'definite-assignment' }).status, 'verified');
  const overflow = verifyObject({ ...objectCase('NewClass'), maxStack: 0 });
  assert.equal(diagnostic(overflow), 'StackOverflow');
  assert.equal(overflow.diagnostics[0].offset, 0);
  assert.equal(verifyObject(objectCase('NewArguments')).peakStack, 2);
  const wrong = verifyObject(objectCase('NewWrongArgument'));
  assert.equal(wrong.diagnostics[0].offset, 1);
  assert.equal(verifyObject(objectCase('NewWrongReturn')).diagnostics[0].offset, 5);
});

test('unboxed addresses remain readonly while unsupported nominal indirect storage remains unknown', () => {
  assert.equal(verifyObject(objectCase('UnboxFieldRead')).status, 'verified');
  assert.equal(diagnostic(verifyObject(objectCase('UnboxFieldWrite'))), 'StackUnexpected');
  const indirect = { name: 'UnboxIndirect', parameters: ['object'], result: 'int', body(writer, input) {
    writer.op('ldarg.0').op('unbox', input.types.Value).op('ldind.i4').op('ret');
  } };
  const report = verifyObject(indirect);
  assert.equal(report.status, 'unknown');
  assert.equal(diagnostic(report), 'MemoryTypeUnavailable');
});

test('literal and field preparation compose in both instruction orders without changing the object profile', () => {
  for (const objectFirst of [true, false]) {
    const fixture = { name: 'MixedObjectLiteral', body(writer, input) {
      if (objectFirst) writer.op('newobj', input.constructors.Owner).op('pop');
      writer.op('ldstr', 0x70000000 + input.builder.userString('mixed')).op('pop');
      if (!objectFirst) writer.op('newobj', input.constructors.Owner).op('pop');
      writer.op('newobj', input.constructors.Owner).op('ldfld', input.members['Owner.Number']).op('pop').op('ret');
    } };
    const report = verifyObject(fixture);
    assert.equal(report.status, 'verified');
    assert.equal(report.profile, 'SharpForge.TypedCIL.Objects/1');
    assert.equal(verifyObject(fixture, { maxStringLiterals: 0 }).status, 'unknown');
  }
});

test('object preparation uses raw operands and rejects newly missing annotations on a cached inspector', () => {
  const prepared = prepareObject(objectCase('HarmlessAnnotation'));
  prepared.inspector.describeToken = () => { throw new Error('No display decoding is required'); };
  assert.equal(verifyCilMethodTypes(prepared.inspector, prepared.input.method, prepared.options).status, 'verified');
  assert.equal(prepared.inspector.cache.size, 0);
  const options = { ...prepared.options, objectTypeAnnotations: undefined };
  assert.equal(diagnostic(verifyCilMethodTypes(prepared.inspector, prepared.input.method, options)), 'ObjectAnnotationAuthorityUnavailable');
});
