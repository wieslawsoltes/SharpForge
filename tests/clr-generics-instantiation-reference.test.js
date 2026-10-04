import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTypeSignature } from '@sharpforge/cil';
import { LoadErrorCode, TypeKind } from '../packages/clr/src/index.js';
import { NativeInstantiationReplay, canonicalNativeShape, readNativeInstantiation } from './clr-generics-instantiation-native.js';
import { compareNativeType, methodSignatureShape, srmSignatureShape } from './clr-generics-instantiation-projections.js';

const fails = code => error => error.code === code;
const categoryChecks = new Set(['malformed-wrongClassKind', 'malformed-wrongValueKind']);
const functionObservations = Object.freeze({
  'managedFunction-resolved': 'function-closed', 'nativeFunction-resolved': 'function-cdecl', 'nestedFunction-resolved': 'function-nested',
});

function compareIdentity(cases, identity, replay) {
  const endpoints = [identity.left, identity.right];
  for (const id of endpoints) assert.ok(cases.has(id), `Native identity endpoint ${id} must exist`);
  const unavailable = endpoints.filter(id => !cases.get(id).result);
  assert.deepEqual(identity.unavailable, unavailable);
  if (unavailable.length) {
    assert.equal(identity.status, 'unavailable');
    assert.equal(identity.same, null, 'A failed native operation cannot supply a ReferenceEquals fact');
    for (const id of unavailable) {
      assert.ok(cases.get(id).error, `${id}: native rejection must be retained`);
      assert.equal(replay.values.has(id), false, `${id}: product acceptance cannot hide behind an unavailable identity`);
    }
    return 'unavailable';
  }
  assert.equal(identity.status, 'observed');
  assert.equal(typeof identity.same, 'boolean');
  assert.ok(endpoints.every(id => replay.values.has(id)), 'Each observed identity endpoint must be replayed');
  assert.equal(replay.values.get(identity.left) === replay.values.get(identity.right), identity.same, endpoints.join(' and '));
  return 'observed';
}

async function replayCase(replay, native, item) {
  if (item.comparison === 'constraint-unsupported-2463') {
    await assert.rejects(replay.run(item), fails(LoadErrorCode.UnsupportedFeature), item.id);
    return 'constraint-unsupported-2463';
  }
  if (categoryChecks.has(item.id)) {
    await assert.rejects(replay.run(item), fails(LoadErrorCode.TypeLoad), item.id);
    return item.error ? 'native-and-product-rejection' : 'explicit-class-value-integrity-difference';
  }
  if (item.id === 'scopeByRef-resolved') {
    await assert.rejects(replay.run(item), fails(LoadErrorCode.InvalidImage), item.id);
    return 'explicit-TypeSpec-byref-context-boundary';
  }
  if (item.error && functionObservations[item.id]) {
    const type = await replay.run(item);
    const reference = native.cases.find(candidate => candidate.id === functionObservations[item.id]);
    assert.ok(reference.result, `${item.id}: independent reflected method signature`);
    assert.equal(type.kind, TypeKind.FunctionPointer);
    assert.deepEqual(replay.shape(type), canonicalNativeShape(reference.result.shape), item.id);
    return 'descriptor-supported-native-ResolveType-rejected';
  }
  if (item.error) {
    const code = item.id === 'malformed-invalidElement' ? LoadErrorCode.InvalidImage : LoadErrorCode.TypeLoad;
    await assert.rejects(replay.run(item), fails(code), item.id);
    return 'native-and-product-rejection';
  }
  assert.ok(item.result, `${item.id}: native result must be retained`);
  const type = await replay.run(item);
  const comparison = compareNativeType(replay, type, item.result, item.id);
  if (item.request.op === 'methodParameterDescriptor') {
    const module = await replay.module(item.request.image);
    const method = module.methodDefinition(item.request.token);
    const parameter = method.signature.parameters[item.request.index];
    assert.deepEqual(methodSignatureShape(parameter, item.request), canonicalNativeShape(item.result.shape), `${item.id}: raw method signature`);
    assert.equal(type.signature.callingConvention, parameter.signature.callingConvention, `${item.id}: calling convention`);
    assert.equal(type.signature.hasThis, parameter.signature.hasThis, `${item.id}: receiver`);
    assert.equal(type.signature.genericArity, parameter.signature.genericArity, `${item.id}: signature arity`);
  }
  return comparison;
}

test('CLR generic instantiation replays every pinned native identity, scope and substituted graph observation', async context => {
  const { native, images } = await readNativeInstantiation();
  assert.equal(native.cases.length, 101);
  assert.equal(new Set(native.cases.map(item => item.id)).size, 101);
  const replay = new NativeInstantiationReplay(native, images);
  const comparisons = new Map();
  const identities = { observed: 0, unavailable: 0 };
  for (const item of native.cases) {
    const comparison = await replayCase(replay, native, item);
    comparisons.set(comparison, (comparisons.get(comparison) ?? 0) + 1);
  }
  const cases = new Map(native.cases.map(item => [item.id, item]));
  for (const identity of native.identities) identities[compareIdentity(cases, identity, replay)]++;
  assert.equal(comparisons.get('constraint-unsupported-2463'), 2);
  assert.equal(comparisons.get('explicit-TypeSpec-byref-context-boundary'), 1);
  assert.ok(comparisons.get('fixture-type-graph') > 0);
  assert.ok(comparisons.get('host-intrinsic-shape') > 0);
  await replay.assertNoBodies();
  context.diagnostic(JSON.stringify({ sdk: native.sdk, runtime: native.runtime, cases: native.cases.length,
    identities, comparisons: Object.fromEntries(comparisons),
    omittedReflectionSurfaces: ['BCL assembly/interface graph', 'fullName/AQN', 'function-pointer reflection flags and named conventions'] }));
});

test('CLR generic native inputs retain independent SRM signatures and explicit context-invalid TypeSpec observations', async () => {
  const { native, images } = await readNativeInstantiation();
  const replay = new NativeInstantiationReplay(native, images);
  assert.equal(native.signatures.length, 5);
  let comparisons = 0;
  let rejectedByRefRoots = 0;
  let malformed = 0;
  for (const observation of native.signatures) {
    const module = await replay.module(observation.image);
    const image = native.images.find(candidate => candidate.id === observation.image);
    assert.equal(observation.rows.length, module.rowCount(27));
    for (const row of observation.rows) {
      const bytes = module.blob(module.row(row.token)[0]);
      assert.deepEqual(bytes, Uint8Array.from(Buffer.from(row.blob, 'base64')), `${observation.image}: signature bytes`);
      if (row.error) {
        assert.throws(() => decodeTypeSignature(bytes));
        malformed++;
      } else if (row.token === image.specifications.scopeByRef) {
        assert.equal(row.signature.kind, 'byref');
        assert.throws(() => decodeTypeSignature(bytes), /Byref is invalid in this signature/);
        rejectedByRefRoots++;
      } else {
        assert.deepEqual(srmSignatureShape(decodeTypeSignature(bytes)), row.signature, `${observation.image}:${row.token}`);
        comparisons++;
      }
    }
  }
  assert.equal(rejectedByRefRoots, 2);
  assert.equal(malformed, 1);
  assert.ok(comparisons >= 25, 'All remaining populated SRM TypeSpecs must be compared');
  await replay.assertNoBodies();
});

test('CLR native collectible generic cases preserve defining ownership and retained identities after unload', async context => {
  const { native, images } = await readNativeInstantiation();
  const reference = native.lifetime.reference;
  assert.equal(reference.cases.length, 7);
  assert.deepEqual(reference.contexts, [{ id: 'a', collectible: true }, { id: 'b', collectible: true }]);
  const replay = new NativeInstantiationReplay(native, images);
  for (const item of reference.cases) {
    assert.ok(item.result);
    compareNativeType(replay, await replay.run(item), item.result, item.id);
  }
  const cases = new Map(reference.cases.map(item => [item.id, item]));
  for (const identity of reference.identities) assert.equal(compareIdentity(cases, identity, replay), 'observed');
  assert.equal(replay.unloadEvents.get('a'), reference.firstUnloadEvents);
  assert.equal(replay.unloadEvents.get('b'), reference.secondUnloadEvents);
  assert.equal(reference.firstUnloadEvents, 1);
  assert.equal(reference.secondUnloadEvents, 1);
  assert.equal(native.lifetime.collection.comparison, 'observation-only');
  assert.equal(native.lifetime.collection.rounds, 8);
  assert.equal(typeof native.lifetime.collection.firstContextCollected, 'boolean');
  assert.equal(typeof native.lifetime.collection.secondContextCollected, 'boolean');
  await replay.assertNoBodies();
  context.diagnostic(JSON.stringify({ nativeGcObservation: native.lifetime.collection,
    comparison: 'Deterministic identity and descriptor observations; collection timing is covered separately by the Node GC probe' }));
});
