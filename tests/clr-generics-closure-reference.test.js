import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCoded, decodeTypeSignature } from '@sharpforge/cil';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { NativeInstantiationReplay, canonicalNativeShape } from './clr-generics-instantiation-native.js';
import { compareNativeType, srmSignatureShape } from './clr-generics-instantiation-projections.js';
import { readNativeClosure } from './clr-generics-closure-native.js';

function endpoint(replay, observation) {
  const value = replay.values.get(observation.request.operation);
  if (!observation.available) {
    assert.equal(value, undefined, 'Unavailable native endpoints cannot hide product acceptance');
    assert.equal(observation.shape, null);
    assert.equal(observation.unavailableBecause, 'native-operation-exception');
    return null;
  }
  assert.ok(value);
  assert.equal(observation.unavailableBecause, null);
  const selected = observation.request.selection === 'type' ? value
    : (value.genericDefinition ? value.genericArguments : value.genericParameters)[observation.request.index];
  assert.ok(selected);
  assert.deepEqual(replay.shape(selected), canonicalNativeShape(observation.shape));
  return selected;
}

test('CLR finite-instantiation closure replays every isolated native request and available identity', async context => {
  const { native, images } = await readNativeClosure();
  const counts = { operations: 0, accepted: 0, rejected: 0, identities: 0, unavailableIdentities: 0 };
  for (const item of native.cases) {
    const replay = new NativeInstantiationReplay(native, images);
    for (const operation of item.operations) {
      counts.operations++;
      if (operation.error) {
        // A new native error category is a qualification discrepancy, not an inferred TypeLoad result.
        assert.equal(operation.error.managedType, 'System.TypeLoadException', `${item.id}:${operation.id}: native category`);
        assert.equal(operation.error.hresult, -2146233054);
        assert.equal(operation.nativeReturned, false);
        assert.equal(operation.descriptionCompleted, false);
        assert.equal(operation.result, null);
        await assert.rejects(replay.run(operation), error => error.code === LoadErrorCode.TypeLoad, `${item.id}:${operation.id}`);
        counts.rejected++;
      } else {
        assert.equal(operation.stage, 'complete');
        assert.equal(operation.nativeReturned, true);
        assert.equal(operation.descriptionCompleted, true);
        let actual;
        try { actual = await replay.run(operation); }
        catch (cause) { throw new Error(`${item.id}:${operation.id}: product rejected a native-success operation`, { cause }); }
        compareNativeType(replay, actual, operation.result, `${item.id}:${operation.id}`);
        counts.accepted++;
      }
    }
    for (const identity of item.identities) {
      counts.identities++;
      const left = endpoint(replay, identity.left);
      const right = endpoint(replay, identity.right);
      if (left === null || right === null) {
        assert.equal(identity.sameReference, null);
        counts.unavailableIdentities++;
      } else assert.equal(left === right, identity.sameReference, `${item.id}:${identity.id}`);
    }
    await replay.assertNoBodies();
  }
  assert.equal(counts.operations, 71);
  assert.equal(counts.identities, 38);
  context.diagnostic(JSON.stringify({ sdk: native.sdk, runtime: native.runtime, ...counts,
    comparison: 'Requested finite generic closure, structural graph and available within-process identity; no executable members or constraints' }));
});

test('CLR finite-closure input graphs retain every raw SRM inheritance edge and scoped formal', async () => {
  const { native, images } = await readNativeClosure();
  const replay = new NativeInstantiationReplay(native, images);
  assert.equal(native.metadata.length, 14);
  for (const observation of native.metadata) {
    const module = await replay.module(observation.image);
    const records = observation.records;
    assert.equal(records.source, 'System.Reflection.Metadata');
    assert.equal(records.typeDefinitions.length, module.rowCount(2));
    for (const expected of records.typeDefinitions) {
      const row = module.row(expected.token);
      assert.equal(row[0], expected.attributes);
      assert.equal(module.string(row[1]), expected.name);
      assert.equal(module.string(row[2]), expected.namespace);
      assert.equal(row[3] ? decodeCoded('TypeDefOrRef', row[3]) : 0, expected.extendsToken);
      assert.deepEqual(module.genericParameters(expected.token).map(parameter => parameter.metadataToken), expected.genericParameters);
      for (const contract of expected.interfaces) {
        const interfaceRow = module.row(contract.token);
        assert.equal(interfaceRow[0], expected.token & 0xffffff);
        assert.equal(decodeCoded('TypeDefOrRef', interfaceRow[1]), contract.interfaceToken);
      }
    }
    assert.equal(records.genericParameters.length, module.rowCount(42));
    for (const expected of records.genericParameters) {
      const parameter = module.genericParameters(expected.ownerToken)[expected.index];
      assert.equal(parameter.metadataToken, expected.token);
      assert.equal(parameter.genericParameterOwner, module.typeDefinition(expected.ownerToken));
      assert.equal(parameter.genericParameterAttributes, expected.attributes);
      assert.deepEqual(parameter.genericParameterConstraintTokens, expected.constraints);
    }
    assert.equal(records.typeSpecifications.length, module.rowCount(27));
    for (const expected of records.typeSpecifications) {
      const bytes = module.blob(module.row(expected.token)[0]);
      assert.deepEqual(bytes, Uint8Array.from(Buffer.from(expected.blob, 'base64')));
      assert.equal(expected.error, null);
      assert.deepEqual(srmSignatureShape(decodeTypeSignature(bytes)), expected.signature);
    }
  }
  await replay.assertNoBodies();
});
