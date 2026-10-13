import test from 'node:test';
import assert from 'node:assert/strict';
import { TypeKind, LoadErrorCode } from '../packages/clr/src/index.js';
import { arrayContext } from './clr-types-array-fixtures.js';
import { genericConsumer, genericFixture, openGenerics } from './clr-generics-instantiation-fixtures.js';

test('CLR canonical generic identities cover closed, open, partially open and own-parameter normalization', async () => {
  const { types, definitions, module, specs } = await openGenerics();
  const integer = types.intrinsic('System.Int32');
  const text = types.intrinsic('System.String');
  const closed = await types.instantiate(definitions.box, [integer]);
  assert.equal(closed, await types.instantiate(definitions.box, [integer]));
  assert.equal(closed, await types.load(module, specs.boxInteger));
  assert.equal(closed.kind, TypeKind.Instantiation);
  assert.equal(closed.genericDefinition, definitions.box);
  assert.deepEqual(closed.genericArguments, [integer]);
  assert.deepEqual(closed.genericParameters, []);
  assert.equal(closed.module, module);
  assert.equal(closed.metadataToken, definitions.box.metadataToken);
  assert.equal(closed.isLoaded, true);
  assert.equal(closed.containsGenericParameters, false);
  assert.equal(closed.baseType, types.intrinsic('System.Object'));
  assert.ok(Object.isFrozen(closed));
  assert.ok(Object.isFrozen(closed.genericArguments));
  assert.equal(await types.instantiate(definitions.box, definitions.box.genericParameters), definitions.box);
  const partial = await types.instantiate(definitions.pair, [text, definitions.other.genericParameters[0]]);
  assert.equal(partial.containsGenericParameters, true);
  assert.equal(partial.genericArguments[1].genericParameterOwner, definitions.other);
  const first = await types.instantiate(definitions.box, [definitions.pair.genericParameters[0]]);
  const second = await types.instantiate(definitions.box, [definitions.other.genericParameters[0]]);
  assert.equal(first.fullName, second.fullName, 'Diagnostic spelling does not establish handle identity');
  assert.notEqual(first, second);
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR referring assemblies and explicit shared definitions resolve the same generic tuple', async () => {
  const fixture = genericFixture();
  const context = arrayContext({ load: ({ assemblyName }) => assemblyName.name === 'GenericDefinitions' ? fixture.image : null });
  const first = genericConsumer('ConsumerA');
  const second = genericConsumer('ConsumerB');
  const moduleA = (await context.loadFromStream(first.image)).manifestModule;
  const moduleB = (await context.loadFromStream(second.image)).manifestModule;
  const [left, right] = await Promise.all([
    context.types.load(moduleA, first.specification), context.types.load(moduleB, second.specification),
  ]);
  assert.equal(left, right);
  const caller = arrayContext();
  assert.equal(await caller.types.instantiate(left.genericDefinition, left.genericArguments), left);
  assert.equal(left.loadContext, context);
  const other = await openGenerics();
  const distinct = await other.types.instantiate(other.definitions.box, [other.types.intrinsic('System.Int32')]);
  assert.notEqual(left, distinct);
  assert.equal(left.fullName, distinct.fullName);
  assert.equal(moduleA.methodBodyReadCount + moduleB.methodBodyReadCount + left.module.methodBodyReadCount, 0);
});

test('CLR generic instantiation unifies the pre-existing vector-interface cache', async () => {
  const types = arrayContext().types;
  const integer = types.intrinsic('System.Int32');
  const vector = types.szArray(integer);
  for (const name of ['IEnumerable', 'ICollection', 'IList', 'IReadOnlyCollection', 'IReadOnlyList']) {
    const definition = types.intrinsic(`System.Collections.Generic.${name}\`1`);
    const type = await types.instantiate(definition, [integer]);
    assert.ok(vector.interfaces.includes(type));
    assert.equal(type.isInterface, true);
    assert.equal(type.containsGenericParameters, false);
  }
});

test('CLR generic type arguments reject structural invalidity and explicitly defer constraint enforcement', async () => {
  const { types, definitions, module, specs } = await openGenerics();
  const integer = types.intrinsic('System.Int32');
  const closed = await types.instantiate(definitions.box, [integer]);
  const failures = [
    [null, [integer]], [integer, [integer]], [closed, [integer]], [definitions.box, []],
    [definitions.box, [integer, integer]], [definitions.box, null], [definitions.box, [null]],
    [definitions.box, [types.pointer(integer)]], [definitions.box, [types.byRef(integer)]],
    [definitions.box, [types.functionPointer({ returnType: integer })]], [definitions.box, [types.intrinsic('System.Void')]],
  ];
  for (const [definition, arguments_] of failures) {
    await assert.rejects(types.instantiate(definition, arguments_), error => error.code === LoadErrorCode.TypeLoad);
  }
  await assert.rejects(types.instantiate(definitions.box, Array(1025).fill(integer)), error => error.code === LoadErrorCode.TypeLoad);
  await assert.rejects(types.instantiate(definitions.constrained, [integer]), error => error.code === LoadErrorCode.UnsupportedFeature);
  const variant = await types.instantiate(definitions.variant, [integer]);
  assert.equal(variant.genericDefinition.genericParameters[0].genericParameterAttributes, 1);
  assert.throws(() => types.isAssignableFrom(variant, variant), error => error.code === LoadErrorCode.TypeLoad);
  const cell = await types.load(module, specs.cellInteger);
  assert.equal(cell.genericDefinition.kind, TypeKind.ValueType);
  assert.equal(cell.baseType, types.intrinsic('System.ValueType'));
});
