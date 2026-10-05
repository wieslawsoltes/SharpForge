import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { generic, openGenerics, variable } from './clr-generics-instantiation-fixtures.js';

test('CLR TypeSpec VAR and MVAR environments are ordered handles and never a module/token-only result cache', async () => {
  const { types, module, specs, definitions, tokens } = await openGenerics();
  const integer = types.intrinsic('System.Int32');
  const text = types.intrinsic('System.String');
  const first = await types.load(module, specs.scopePair, { typeArguments: [integer], methodArguments: [text] });
  const second = await types.load(module, specs.scopePair, { typeArguments: [text], methodArguments: [integer] });
  assert.equal(first, await types.instantiate(definitions.pair, [integer, text]));
  assert.notEqual(first, second);
  assert.equal(first, await types.load(module, specs.scopePair, { typeArguments: [integer], methodArguments: [text] }));
  const parameter = definitions.other.genericParameters[0];
  const methodParameter = module.methodGenericParameters(tokens.method)[0];
  const partial = await types.load(module, specs.scopePair, { typeArguments: [parameter], methodArguments: [methodParameter] });
  assert.deepEqual(partial.genericArguments, [parameter, methodParameter]);
  assert.equal(partial.containsGenericParameters, true);
  assert.equal(methodParameter.genericParameterOwner, module.methodDefinition(tokens.method));
  assert.equal((await types.load(module, specs.scopeArray, { typeArguments: [parameter] })).elementType, parameter);
  const nested = await types.load(module, specs.scopeNested, { typeArguments: [text] });
  assert.deepEqual(nested.genericArguments[0].elementType.genericArguments, [text, integer]);
  assert.equal(await types.load(module, specs.scopeType, { typeArguments: [parameter] }), parameter);
  assert.equal(await types.load(module, specs.scopeMethod, { methodArguments: [methodParameter] }), methodParameter);
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR TypeSpec rejects missing, undersized and malformed environments without guessing a neighboring declaration', async () => {
  const { types, module, specs, definitions } = await openGenerics({}, { decorate({ specification, tokens }) {
    specification('secondVariable', generic(tokens.box, [variable(1)]));
  } });
  const integer = types.intrinsic('System.Int32');
  for (const scope of [{}, { typeArguments: [] }, { typeArguments: [integer] },
    { typeArguments: [integer], methodArguments: [] }, { methodArguments: [integer] }]) {
    await assert.rejects(types.load(module, specs.scopePair, scope), error => error.code === LoadErrorCode.TypeLoad);
  }
  for (const scope of [{ typeArguments: null }, { methodArguments: 'bad' }, { typeArguments: [0x02000002] },
    { typeArguments: Array(1025).fill(integer) }]) {
    await assert.rejects(types.load(module, specs.scopeType, scope), error => error.code === LoadErrorCode.TypeLoad);
  }
  await assert.rejects(types.load(module, specs.secondVariable, { typeArguments: [integer] }), /Unbound type generic parameter 1/);
  const good = await types.load(module, specs.scopePair, { typeArguments: [integer], methodArguments: [integer] });
  assert.equal(good, await types.instantiate(definitions.pair, [integer, integer]));
});

test('CLR replacement handles retain their original module and generic parameter owner', async () => {
  const first = await openGenerics();
  const second = await openGenerics({}, { name: 'OtherDefinitions' });
  assert.equal(first.definitions.box.metadataToken, second.definitions.box.metadataToken);
  const foreign = second.definitions.box;
  const result = await first.types.load(first.module, first.specs.scopePair, {
    typeArguments: [foreign], methodArguments: [second.definitions.other.genericParameters[0]],
  });
  assert.equal(result.genericArguments[0], foreign);
  assert.notEqual(result.genericArguments[0], first.definitions.box);
  assert.equal(result.genericArguments[1].module, second.module);
  assert.equal(result.genericArguments[1].genericParameterOwner, second.definitions.other);
  assert.equal(result.loadContext, first.context);
});

test('CLR a cross-context TypeSpec request snapshots each explicit environment property once', async () => {
  const owner = await openGenerics();
  const caller = await openGenerics({}, { name: 'CallingContext' });
  const integer = owner.types.intrinsic('System.Int32');
  const text = owner.types.intrinsic('System.String');
  let typeReads = 0;
  let methodReads = 0;
  const result = await caller.types.load(owner.module, owner.specs.scopePair, {
    get typeArguments() { typeReads++; return [integer]; },
    get methodArguments() { methodReads++; return [text]; },
  });
  assert.deepEqual(result.genericArguments, [integer, text]);
  assert.equal(typeReads, 1);
  assert.equal(methodReads, 1);
});
