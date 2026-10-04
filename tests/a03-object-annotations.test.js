import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCilMethodTypes } from '@sharpforge/cil';
import { objectCase, prepareObject, verifyObject } from './helpers/object-verifier.js';

function unavailable(options) {
  const report = verifyObject(objectCase('HarmlessAnnotation'), options);
  assert.equal(report.status, 'unknown', JSON.stringify(report));
  assert.equal(report.diagnostics[0].diagnostic, 'ObjectAnnotationAuthorityUnavailable');
  return report;
}

test('known harmless and byref-like constructor identities produce distinct policies; names convey no authority', () => {
  assert.equal(verifyObject(objectCase('HarmlessAnnotation')).status, 'verified');
  const rejected = verifyObject(objectCase('RefLikeBox'));
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.diagnostics[0].diagnostic, 'BoxByRef');
  assert.equal(verifyObject(objectCase('CounterfeitNameWithoutAuthority')).status, 'unknown');
  assert.equal(verifyObject(objectCase('CounterfeitKnownHarmless')).status, 'verified');
  assert.equal(verifyObject(objectCase('MissingAnnotationAuthority')).status, 'unknown');
  for (const objectTypeAnnotations of [undefined, { classifyConstructor: () => ({ status: 'known', value: { byRefLike: 'false' } }) }])
    assert.equal(verifyObject(objectCase('RefLikeBox'), { objectTypeAnnotations }).status, 'unknown');
});

test('missing, throwing, async and malformed annotation providers retain stable unknown diagnostics', () => {
  for (const authority of [undefined, {}, { classifyConstructor: null }, { classifyConstructor: true },
    { classifyConstructor() { throw new Error('unavailable backend'); } }])
    unavailable({ objectTypeAnnotations: authority });
  unavailable({ get objectTypeAnnotations() { throw new Error('unavailable authority'); } });
  const malformed = [null, false, [], Promise.resolve(false), { status: 'known' }, { status: 'known', value: null },
    { status: 'known', value: { byRefLike: 'false' } }, { status: 'known', value: { byRefLike: 0 } },
    { status: 'unknown' }, { status: 'unknown', reason: '' }, { status: 'unknown', reason: 'x'.repeat(257) },
    { status: 'known', value: { byRefLike: false }, then() {} },
    { get status() { throw new Error('unreadable result'); } },
    { status: 'known', value: { get byRefLike() { throw new Error('unreadable classification'); } } }];
  for (const response of malformed) unavailable({ objectTypeAnnotations: { classifyConstructor: () => response } });
  const report = unavailable({ objectTypeAnnotations: {
    classifyConstructor: () => ({ status: 'unknown', reason: 'constructor-resolution-not-prepared' }),
  } });
  assert.equal(report.diagnostics[0].message, 'constructor-resolution-not-prepared');
});

test('each distinct annotation constructor is classified once across tokens, aliases and duplicate rows', () => {
  const fixture = { name: 'AnnotationReuse', parameters: ['valuetype Fixture.Value', 'valuetype Fixture.OtherValue'],
    annotations: [{ kind: 'harmless', count: 64 }, { kind: 'harmless', owner: 'OtherValue' }],
    decorate(input) {
      input.alias = input.builder.addRow('TypeRef', { ResolutionScope: 1, Name: 'Value', Namespace: 'Fixture' });
    },
    body(writer, input) {
      for (let index = 0; index < 32; index++) {
        writer.op('ldarg.0').op('box', input.types.Value).op('pop');
        writer.op('ldarg.0').op('box', input.alias).op('pop');
        writer.op('ldarg.1').op('box', input.types.OtherValue).op('pop');
      }
      writer.op('ret');
    } };
  const prepared = prepareObject(fixture);
  const calls = [];
  const options = { ...prepared.options, maxObjectAnnotationRows: 65, maxObjectAnnotationBytes: 3,
    objectTypeAnnotations: { classifyConstructor(token) {
      calls.push(token);
      assert.ok(prepared.input.annotations.has(token));
      return { status: 'known', value: { byRefLike: false } };
    } } };
  for (let invocation = 0; invocation < 2; invocation++) {
    assert.equal(verifyCilMethodTypes(prepared.inspector, prepared.input.method, options).status, 'verified');
    assert.equal(calls.length, invocation + 1);
  }
  assert.equal(new Set(calls).size, 1);
});

test('classification snapshots scalar facts and reads one provider result per constructor', () => {
  let reads = 0;
  const response = { status: 'known', value: { get byRefLike() { reads++; return false; } } };
  const report = verifyObject({ ...objectCase('HarmlessAnnotation'), annotations: [{ kind: 'harmless', count: 64 }] }, {
    objectTypeAnnotations: { classifyConstructor: () => response },
  });
  assert.equal(report.status, 'verified');
  assert.equal(reads, 1);
  const mixed = { ...objectCase('BoxValue'), annotationAuthority: true,
    annotations: [{ kind: 'harmless' }, { kind: 'byRefLike' }] };
  assert.equal(verifyObject(mixed).diagnostics[0].diagnostic, 'BoxByRef');
});

test('nonboxing ref-like conversions stay unknown until the missing lifetime authority is implemented', () => {
  for (const opcode of ['castclass', 'isinst', 'unbox', 'unbox.any']) {
    const report = verifyObject({ name: opcode, parameters: ['object'], annotations: [{ kind: 'byRefLike' }], annotationAuthority: true,
      body(writer, input) { writer.op('ldarg.0').op(opcode, input.types.Value).op('pop').op('ret'); } });
    assert.equal(report.status, 'unknown', opcode);
    assert.equal(report.diagnostics[0].diagnostic, 'ByRefLikeObjectUnavailable');
  }
});

test('attribute constructor metadata is checked before any host classification can grant boxing', () => {
  for (const malformed of ['name', 'signature', 'extent']) {
    let calls = 0;
    const fixture = { ...objectCase('HarmlessAnnotation'), decorate(input) {
      const token = [...input.annotations.keys()][0];
      const row = input.builder.rows[10][(token & 0xffffff) - 1];
      if (malformed === 'name') row[1] = input.builder.string('NotAConstructor');
      if (malformed === 'signature') row[2] = input.builder.blob(Uint8Array.of(0, 0, 1));
      if (malformed === 'extent') {
        // Stay within the two-byte coded-index width while addressing a missing MemberRef.
        assert.ok(input.builder.rows[10].length < 0x1fff);
        input.builder.rows[12][0][1] = (0x1fff << 3) | 3;
      }
    } };
    const report = verifyObject(fixture, { objectTypeAnnotations: { classifyConstructor() {
      calls++;
      return { status: 'known', value: { byRefLike: false } };
    } } });
    assert.equal(report.status, 'rejected', JSON.stringify({ malformed, report }));
    assert.equal(calls, 0);
    if (malformed !== 'extent') assert.equal(report.diagnostics[0].diagnostic, 'ObjectAnnotationMetadata');
    else assert.equal(report.diagnostics[0].code, 'CILVM0001');
  }
  const staticConstructor = { ...objectCase('CounterfeitKnownHarmless'), decorate(input) {
    input.builder.rows[6][(input.constructors.IsByRefLikeAttribute & 0xffffff) - 1][2] |= 0x10;
  } };
  assert.equal(verifyObject(staticConstructor).diagnostics[0].diagnostic, 'ObjectAnnotationMetadata');
  const modified = { ...objectCase('HarmlessAnnotation'), decorate(input) {
    const token = [...input.annotations.keys()][0];
    input.builder.rows[10][(token & 0xffffff) - 1][2] = input.builder.blob(Uint8Array.of(0x20, 0, 0x20, 8, 1));
  } };
  const report = verifyObject(modified);
  assert.equal(report.status, 'unknown');
  assert.equal(report.diagnostics[0].diagnostic, 'ObjectAnnotationSignatureUnavailable');
});
