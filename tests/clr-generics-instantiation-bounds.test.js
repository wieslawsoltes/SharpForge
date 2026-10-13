import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex } from '@sharpforge/cil';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { arrayContext } from './clr-types-array-fixtures.js';
import { openGenerics } from './clr-generics-instantiation-fixtures.js';

const fails = code => error => error.code === code;

test('CLR generic identity and tuple limits preflight new entries and retain existing canonical results', async () => {
  const context = arrayContext({ typeOptions: { maxConstructedTypes: 3 } });
  const types = context.types;
  const definition = types.defineIntrinsic('Fixture.Pair`2', { genericArity: 2 });
  const integer = types.intrinsic('System.Int32');
  const text = types.intrinsic('System.String');
  const first = await types.instantiate(definition, [integer, integer]);
  const second = await types.instantiate(definition, [integer, text]);
  await types.instantiate(definition, [text, integer]);
  await assert.rejects(types.instantiate(definition, [text, text]), fails(LoadErrorCode.LimitExceeded));
  assert.equal(await types.instantiate(definition, [integer, integer]), first);
  assert.equal(await types.instantiate(definition, [integer, text]), second);
  const other = arrayContext({ typeOptions: { maxConstructedTypes: 2 } }).types;
  const box = other.defineIntrinsic('Fixture.Box`1', { genericArity: 1 });
  const retained = await other.instantiate(box, [other.intrinsic('System.Int32')]);
  await assert.rejects(other.instantiate(box, [other.intrinsic('System.String')]), fails(LoadErrorCode.LimitExceeded));
  assert.equal(await other.instantiate(box, [other.intrinsic('System.Int32')]), retained);
});

test('CLR invalid generic names and arity do not consume handle identity capacity', async () => {
  const types = arrayContext({ typeOptions: { maxConstructedTypes: 2 } }).types;
  const box = types.defineIntrinsic('Fixture.Box`1', { genericArity: 1 });
  const long = types.defineIntrinsic('X'.repeat(4096));
  await assert.rejects(types.instantiate(box, [long]), fails(LoadErrorCode.LimitExceeded));
  await assert.rejects(types.instantiate(box, []), fails(LoadErrorCode.TypeLoad));
  const integer = types.intrinsic('System.Int32');
  const type = await types.instantiate(box, [integer]);
  assert.equal(type.genericArguments[0], integer);
});

test('CLR cross-context instantiation uses the defining type service and its configured work bounds', async () => {
  const owner = await openGenerics();
  const caller = arrayContext({ typeOptions: { maxGenericWork: 1 } }).types;
  const integer = owner.types.intrinsic('System.Int32');
  const result = await caller.instantiate(owner.definitions.box, [integer]);
  assert.equal(result.loadContext, owner.context);
  assert.equal(result, await owner.types.instantiate(owner.definitions.box, [integer]));
  const limited = await openGenerics({ typeOptions: { maxGenericWork: 1 } });
  await assert.rejects(owner.types.instantiate(limited.definitions.box, [integer]), fails(LoadErrorCode.LimitExceeded));
  assert.equal(limited.definitions.box.isLoaded, false);
});

test('CLR ordered generic arrays cannot replace bounded indexing with an arbitrary iterator', async () => {
  const { types, definitions, module, specs } = await openGenerics();
  const integer = types.intrinsic('System.Int32');
  const arguments_ = [integer];
  arguments_[Symbol.iterator] = () => { throw new Error('A caller iterator must not run'); };
  const expected = await types.instantiate(definitions.box, arguments_);
  assert.equal(expected.genericArguments[0], integer);
  assert.equal(await types.load(module, specs.scopeType, { typeArguments: arguments_ }), integer);
  for (const length of [NaN, Infinity, -1, 1.5, 1025]) {
    const proxy = new Proxy(arguments_, { get(target, key) { return key === 'length' ? length : Reflect.get(target, key); } });
    await assert.rejects(types.instantiate(definitions.box, proxy), fails(LoadErrorCode.TypeLoad));
  }
});

test('CLR generic depth, signature byte and per-operation work budgets reject bounded expansion', async () => {
  const types = arrayContext({ typeOptions: { maxDepth: 6 } }).types;
  const box = types.defineIntrinsic('Fixture.Box`1', { genericArity: 1 });
  let argument = types.intrinsic('System.Int32');
  for (let index = 0; index < 5; index++) argument = await types.instantiate(box, [argument]);
  await assert.rejects(types.instantiate(box, [argument]), fails(LoadErrorCode.LimitExceeded));
  let pointer = types.intrinsic('System.Int32');
  for (let index = 0; index < 4; index++) pointer = types.functionPointer({ returnType: pointer });
  await assert.rejects(types.instantiate(box, [types.array(pointer, 1)]), fails(LoadErrorCode.LimitExceeded));
  const bytes = await openGenerics({ typeOptions: { maxTypeSignatureBytes: 2 } });
  await assert.rejects(bytes.types.load(bytes.module, bytes.specs.boxInteger), fails(LoadErrorCode.LimitExceeded));
  assert.equal(await bytes.types.load(bytes.module, bytes.specs.integer), bytes.types.intrinsic('System.Int32'));
  const work = await openGenerics({ typeOptions: { maxGenericWork: 2 } });
  await assert.rejects(work.types.load(work.module, work.specs.scopePair, {
    typeArguments: [work.types.intrinsic('System.Int32')], methodArguments: [work.types.intrinsic('System.String')],
  }), fails(LoadErrorCode.LimitExceeded));
  assert.equal(await work.types.load(work.module, work.specs.integer), work.types.intrinsic('System.Int32'));
  const limited = arrayContext({ typeOptions: { maxGenericWork: 2 } }).types;
  const simple = limited.defineIntrinsic('Fixture.Box`1', { genericArity: 1 });
  const integer = limited.intrinsic('System.Int32');
  const signature = limited.functionPointer({ returnType: integer, parameters: [integer, integer, integer] });
  await assert.rejects(limited.instantiate(simple, [limited.array(signature, 1)]), fails(LoadErrorCode.LimitExceeded));
});

test('CLR generic options and malformed parameter metadata preserve stable diagnostic contracts', async () => {
  for (const typeOptions of [{ maxGenericWork: 0 }, { maxGenericWork: 1000001 }, { maxGenericWork: 1.5 },
    { maxTypeSignatureBytes: 0 }, { maxTypeSignatureBytes: 1048577 }, { maxTypeSignatureBytes: NaN }]) {
    assert.throws(() => arrayContext({ typeOptions }), fails(LoadErrorCode.InvalidConfiguration));
  }
  for (const attributes of [3, 0x80]) {
    const malformed = await openGenerics({}, { decorate({ md }) { md.rows[42][0][1] = attributes; } });
    await assert.rejects(malformed.types.instantiate(malformed.definitions.box, [malformed.types.intrinsic('System.Int32')]),
      fails(LoadErrorCode.TypeLoad));
    await assert.rejects(malformed.types.load(malformed.module, malformed.specs.scopeType, {
      typeArguments: malformed.definitions.box.genericParameters,
    }), fails(LoadErrorCode.TypeLoad));
    assert.equal(malformed.definitions.box.isLoaded, false);
  }
  assert.equal(LoadErrorCode.UnsupportedFeature, 'SFCLR013');
});

test('CLR constrained generic definitions remain explicitly unqualified for every stored constraint form', async () => {
  for (const attributes of [4, 8, 16, 32, 0]) {
    const fixture = await openGenerics({}, { decorate({ md }) {
      md.rows[42][0][1] = attributes;
      if (attributes === 0) md.add(44, [1, codedIndex('TypeDefOrRef', md.typeRef('System.Object'))]);
    } });
    await assert.rejects(fixture.types.instantiate(fixture.definitions.box, [fixture.types.intrinsic('System.String')]),
      fails(LoadErrorCode.UnsupportedFeature));
    await assert.rejects(fixture.types.load(fixture.module, fixture.specs.scopeType, {
      typeArguments: fixture.definitions.box.genericParameters,
    }), fails(LoadErrorCode.UnsupportedFeature));
    assert.equal(fixture.definitions.box.isLoaded, false);
  }
});
