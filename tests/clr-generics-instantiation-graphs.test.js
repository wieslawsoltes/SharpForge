import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { generic, openGenerics, primitive, variable } from './clr-generics-instantiation-fixtures.js';

test('CLR substituted base and diamond interface graphs preserve exact argument ownership and deduplicate handles', async () => {
  const { types, definitions, module } = await openGenerics();
  const integer = types.intrinsic('System.Int32');
  const text = types.intrinsic('System.String');
  const open = await types.load(module, definitions.derived.metadataToken);
  assert.equal(open.baseType.genericDefinition, definitions.box);
  assert.equal(open.baseType.genericArguments[0], definitions.derived.genericParameters[0]);
  assert.notEqual(open.baseType, definitions.box);
  const closed = await types.instantiate(definitions.derived, [integer]);
  assert.equal(closed.baseType, await types.instantiate(definitions.box, [integer]));
  const contract = await types.instantiate(definitions.contract, [integer]);
  assert.equal(closed.interfaces.filter(type => type === contract).length, 1);
  assert.equal(closed.interfaces.length, 3);
  assert.ok(closed.interfaces.every(type => type.isLoaded && type.genericArguments[0] === integer));
  const reorder = await types.instantiate(definitions.reorder, [integer, text]);
  const pair = await types.instantiate(definitions.pair, [text, integer]);
  assert.equal(reorder.baseType.genericDefinition, definitions.box);
  assert.equal(reorder.baseType.genericArguments[0], pair);
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR self-referential generic arguments remain finite while the requested inheritance graph completes', async () => {
  const { types, definitions, module } = await openGenerics();
  const integer = types.intrinsic('System.Int32');
  const definition = await types.load(module, definitions.node.metadataToken);
  assert.equal(definition.baseType.genericArguments[0], definition);
  const instance = await types.instantiate(definition, [integer]);
  assert.equal(instance.baseType.genericArguments[0], instance);
  const argument = instance.interfaces[0].genericArguments[0];
  assert.equal(argument.genericDefinition, definition);
  assert.equal(argument.genericArguments[0], instance);
  assert.equal(argument.isLoaded, false, 'Argument identity does not recursively expand another inherited graph');
  const completedArgument = await types.instantiate(definition, [instance]);
  assert.equal(completedArgument, argument);
  assert.equal(argument.isLoaded, true);
  assert.equal(argument.baseType.genericArguments[0], argument);
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR nested and non-backtick definitions use actual metadata arity and preserve the declaring definition', async () => {
  const { types, definitions } = await openGenerics();
  const integer = types.intrinsic('System.Int32');
  const text = types.intrinsic('System.String');
  const nested = await types.instantiate(definitions.inner, [integer, text]);
  assert.equal(nested.declaringType, definitions.outer);
  assert.deepEqual(nested.genericArguments, [integer, text]);
  assert.equal(nested.genericDefinition.genericParameters[0].genericParameterOwner, definitions.inner);
  assert.equal((await types.instantiate(definitions.inheritedInner, [integer])).declaringType, definitions.outer);
  assert.equal((await types.instantiate(definitions.arityName, [integer, text])).genericArguments.length, 2);
  await assert.rejects(types.instantiate(definitions.inner, [text]), /argument count/);
  await assert.rejects(types.instantiate(definitions.arityName, [text]), /argument count/);
  await assert.rejects(types.instantiate(definitions.detachedInner, [text]), /generic type definition/);
  assert.equal(definitions.detachedInner.containsGenericParameters, false);
});

test('CLR generic inheritance cycles and malformed signature categories never publish a completed type', async () => {
  for (const mutual of [false, true]) {
    const { types, definitions, module } = await openGenerics({}, { decorate({ base, tokens }) {
      base(tokens.box, generic(mutual ? tokens.other : tokens.box, [variable()]), 'badBoxBase');
      if (mutual) base(tokens.other, generic(tokens.box, [variable()]), 'badOtherBase');
    } });
    await assert.rejects(types.instantiate(definitions.box, [types.intrinsic('System.Int32')]), error => error.code === LoadErrorCode.TypeLoad);
    assert.equal(definitions.box.isLoaded, false);
    assert.equal(module.methodBodyReadCount, 0);
  }
  const { types, module, specs } = await openGenerics({}, { decorate({ md, specification, tokens }) {
    specification('wrongClass', generic(tokens.cell, [primitive('int')]));
    specification('wrongValue', generic(tokens.box, [primitive('int')], 'valuetype'));
    specification('wrongArity', generic(tokens.box, [primitive('int'), primitive('int')]));
    specification('cyclic', { kind: 'class', token: 0x1b000000 + md.rows[27].length + 1 });
    specification('malformed', Uint8Array.of(0xff));
  } });
  for (const name of ['wrongClass', 'wrongValue', 'wrongArity', 'cyclic']) {
    await assert.rejects(types.load(module, specs[name]), error => error.code === LoadErrorCode.TypeLoad);
  }
  await assert.rejects(types.load(module, specs.malformed), error => error.code === LoadErrorCode.InvalidImage);
});
