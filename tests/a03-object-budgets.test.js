import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCilMethodTypes } from '@sharpforge/cil';
import { objectCase, prepareObject, verifyObject } from './helpers/object-verifier.js';

function unknown(report, code = 'CILDF0001') {
  assert.equal(report.status, 'unknown', JSON.stringify(report));
  assert.equal(report.diagnostics[0].code, code);
}

test('annotation row and signature-byte limits include zero, exact boundaries and validated hard ceilings', () => {
  for (const [name, maximum] of [['maxObjectAnnotationRows', 65535], ['maxObjectAnnotationBytes', 1048576]]) {
    assert.equal(verifyObject(objectCase('HarmlessAnnotation'), { [name]: maximum }).status, 'verified');
    for (const value of [0, -1, NaN, Infinity, 1.5, '1', maximum + 1])
      unknown(verifyObject(objectCase('HarmlessAnnotation'), { [name]: value }));
  }
  const exact = { maxObjectAnnotationRows: 1, maxObjectAnnotationBytes: 3 };
  assert.equal(verifyObject(objectCase('HarmlessAnnotation'), exact).status, 'verified');
  unknown(verifyObject(objectCase('HarmlessAnnotation'), { ...exact, maxObjectAnnotationBytes: 2 }));
  assert.equal(verifyObject(objectCase('BoxValue'), { maxObjectAnnotationRows: 0, maxObjectAnnotationBytes: 0 }).status, 'verified');
  const unrelated = { ...objectCase('NewClass'), annotations: [{ kind: 'harmless' }] };
  assert.equal(verifyObject(unrelated, { maxObjectAnnotationRows: NaN, maxObjectAnnotationBytes: NaN }).status, 'verified');
});

test('row scans charge all custom-attribute rows while duplicate signature blobs consume bytes once', () => {
  const fixture = { ...objectCase('HarmlessAnnotation'), annotations: [{ kind: 'harmless', count: 3 }, { kind: 'counterfeit' }] };
  assert.equal(verifyObject(fixture, { maxObjectAnnotationRows: 4, maxObjectAnnotationBytes: 3 }).status, 'verified');
  unknown(verifyObject(fixture, { maxObjectAnnotationRows: 3, maxObjectAnnotationBytes: 3 }));
  const unrelated = { ...objectCase('BoxValue'), annotations: [{ kind: 'harmless', owner: 'Owner' }] };
  unknown(verifyObject(unrelated, { maxObjectAnnotationRows: 0 }));
});

test('newobj uses existing metadata, signature, hierarchy and transfer budgets without weakening their unknown results', () => {
  for (const options of [{ maxTypes: 0 }, { maxMembers: 0 }, { maxQueryNodes: 0 }, { maxDepth: 0 },
    { maxMemberSignatureNodes: 0 }, { maxMemberBytes: 0 }, { maxTypedStackSlots: 0 }, { maxDataflowInstructions: 0 }])
    assert.equal(verifyObject(objectCase('NewClass'), options).status, 'unknown', JSON.stringify(options));
  const prepared = prepareObject(objectCase('NewArguments'));
  assert.equal(verifyCilMethodTypes(prepared.inspector, prepared.input.method, prepared.options).status, 'verified');
  assert.equal(verifyCilMethodTypes(prepared.inspector, prepared.input.method,
    { ...prepared.options, maxMembers: 0 }).status, 'unknown');
});

test('cancellation before verification, during attribute indexing and after authority invocation never returns proof', () => {
  unknown(verifyObject(objectCase('NewClass'), { signal: AbortSignal.abort() }), 'CILDF0002');
  const controller = new AbortController();
  unknown(verifyObject(objectCase('HarmlessAnnotation'), { signal: controller.signal,
    objectTypeAnnotations: { classifyConstructor() {
      controller.abort();
      return { status: 'known', value: { byRefLike: false } };
    } } }), 'CILDF0002');
  let armed = false;
  let checks = 0;
  const options = {
    get maxObjectAnnotationRows() { armed = true; return 65535; },
    signal: { get aborted() { return armed && ++checks >= 4; } },
  };
  const fixture = { ...objectCase('HarmlessAnnotation'), annotations: [{ kind: 'harmless', count: 64 }] };
  unknown(verifyObject(fixture, options), 'CILDF0002');
  assert.equal(checks, 4);
});

test('unreachable value operands still consume annotation preparation work', () => {
  const fixture = { ...objectCase('HarmlessAnnotation'), parameters: [], result: 'void', body(writer, input) {
    writer.op('ret').op('ldnull').op('unbox.any', input.types.Value).op('pop').op('ret');
  } };
  unknown(verifyObject(fixture, { maxObjectAnnotationRows: 0 }));
});
