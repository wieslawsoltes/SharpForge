import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex } from '@sharpforge/cil';
import { TypeKind, LoadErrorCode } from '../packages/clr/src/index.js';
import { arrayContext } from './clr-types-array-fixtures.js';
import { openGenerics, generic, primitive, deferred } from './clr-generics-instantiation-fixtures.js';

async function categoryFixture(select) {
  let types;
  let foreign;
  let calls = 0;
  const state = await openGenerics({ typeOptions: {
    resolveExternalType({ assemblyName, namespace, name, signal }) {
      assert.equal(assemblyName.name, 'System.Runtime');
      if (name === 'ValueType') {
        calls++;
        return select({ calls, signal, own: types.intrinsic('System.ValueType'), foreign });
      }
      return types.intrinsic(`${namespace}.${name}`);
    },
  } }, { decorate({ md, type, specification, tokens }) {
    tokens.plainCell = type('PlainCell', 0, { flags: 0x109 });
    md.rows[2][(tokens.plainCell & 0xffffff) - 1][3] = codedIndex('TypeDefOrRef', md.typeRef('System.ValueType'));
    for (const encoding of ['class', 'valuetype']) {
      const element = generic(tokens.cell, [primitive('int')], encoding);
      specification(encoding, element);
      specification(`${encoding}Array`, { kind: 'szarray', element });
      specification(`${encoding}Plain`, { kind: encoding, token: tokens.plainCell });
    }
    specification('reference', { kind: 'class', token: md.typeRef('System.ValueType') });
    specification('conflicting', generic(tokens.pair, [
      generic(tokens.cell, [primitive('int')], 'class'), generic(tokens.cell, [primitive('int')], 'valuetype'),
    ]));
  } });
  types = state.types;
  foreign = arrayContext().types.intrinsic('System.ValueType');
  return { ...state, foreign, calls: () => calls };
}

const categoryFailure = error => error.code === LoadErrorCode.TypeLoad && /category/.test(error.message);

test('CLR a TypeSpec category and graph completion share one chosen direct base identity', async () => {
  const state = await categoryFixture(({ calls, own, foreign }) => calls === 1 ? foreign : own);
  const type = await state.types.load(state.module, state.specs.class);
  assert.equal(type.genericDefinition, state.definitions.cell);
  assert.equal(type.genericDefinition.kind, TypeKind.Class);
  assert.equal(type.baseType, state.foreign, 'Same spelling in another context is not the owner intrinsic authority');
  assert.equal(state.calls(), 1, 'Category qualification does not perform an independent unstable base read');
  assert.equal(await state.types.load(state.module, state.specs.class), type);
  await assert.rejects(state.types.load(state.module, state.specs.valuetype), categoryFailure);
  assert.equal(state.calls(), 1);
  assert.equal(state.module.methodBodyReadCount, 0);
});

test('CLR nested signature occurrences are qualified even when a born-loaded wrapper leaves its element definition unloaded', async () => {
  const state = await categoryFixture(({ calls, own, foreign }) => calls === 1 ? foreign : own);
  const array = await state.types.load(state.module, state.specs.classArray);
  assert.equal(array.elementType.genericDefinition, state.definitions.cell);
  assert.equal(state.definitions.cell.isLoaded, false);
  assert.equal(state.calls(), 1, 'The wrapped category refers to the exact proof template');
  const completed = await state.types.load(state.module, state.tokens.cell);
  assert.equal(completed.kind, TypeKind.ValueType);
  assert.equal(completed.baseType, state.types.intrinsic('System.ValueType'));
  await assert.rejects(state.types.load(state.module, state.specs.classArray), categoryFailure);
  const correct = await state.types.load(state.module, state.specs.valuetypeArray);
  assert.equal(correct, array, 'The corrected encoding resolves the existing canonical shape, not a parallel identity');
  assert.equal(state.calls(), 2);
});

test('CLR an unloaded signature category is not reused across roots or retained after a failed stronger encoding', async () => {
  let own = true;
  const state = await categoryFixture(values => own ? values.own : values.foreign);
  const first = await state.types.load(state.module, state.specs.valuetypeArray);
  assert.equal(state.definitions.cell.isLoaded, false);
  own = false;
  await assert.rejects(state.types.load(state.module, state.specs.valuetypeArray), categoryFailure);
  assert.equal(state.definitions.cell.isLoaded, false);
  const next = await state.types.load(state.module, state.specs.classArray);
  assert.equal(next, first);
  assert.equal(state.calls(), 3, 'Each root rebinds the still-unloaded definition; a failed category is not cached');
});

test('CLR direct and wrapped class encodings reject a value category before publishing the requested definition', async () => {
  for (const key of ['class', 'classArray', 'classPlain']) {
    const state = await categoryFixture(({ own }) => own);
    await assert.rejects(state.types.load(state.module, state.specs[key]), categoryFailure);
    assert.equal(state.definitions.cell.isLoaded, false);
    assert.equal(state.definitions.plainCell.isLoaded, false, 'A plain nongeneric TypeSpec also activates prepublication qualification');
    assert.equal(state.calls(), 1);
    const correctKey = key.replace('class', 'valuetype');
    assert.ok(await state.types.load(state.module, state.specs[correctKey]));
    assert.equal(state.module.methodBodyReadCount, 0);
  }
});

test('CLR contradictory encodings of one canonical definition reject without resolving a speculative base', async () => {
  const state = await categoryFixture(({ own }) => own);
  await assert.rejects(state.types.load(state.module, state.specs.conflicting), categoryFailure);
  assert.equal(state.calls(), 0);
  assert.equal(state.definitions.cell.isLoaded, false);
  assert.equal(state.definitions.pair.isLoaded, false);
});

test('CLR a pending category read adopts a concurrently published authoritative category', async () => {
  const controller = new AbortController();
  const started = deferred();
  const provider = deferred();
  let firstOwn;
  const state = await categoryFixture(({ signal, own, foreign }) => {
    if (signal === controller.signal) {
      firstOwn = own;
      started.resolve();
      return provider.promise;
    }
    return foreign;
  });
  const pending = state.types.load(state.module, state.specs.valuetypeArray, { signal: controller.signal });
  const rejected = assert.rejects(pending, categoryFailure);
  await started.promise;
  const winner = await state.types.load(state.module, state.specs.class);
  assert.equal(winner.genericDefinition.kind, TypeKind.Class);
  provider.resolve(firstOwn);
  await rejected;
  assert.equal(winner.genericDefinition.baseType, state.foreign);
  assert.equal(state.calls(), 2);
});

test('CLR cancellation of a plain signature category wait is prompt and does not publish or poison its retry', async () => {
  const controller = new AbortController();
  const started = deferred();
  const provider = deferred();
  const state = await categoryFixture(({ signal, own }) => {
    if (signal === controller.signal) {
      started.resolve();
      return provider.promise;
    }
    return own;
  });
  const pending = state.types.load(state.module, state.specs.valuetypePlain, { signal: controller.signal });
  const rejected = assert.rejects(pending, error => error.code === LoadErrorCode.Cancelled);
  await started.promise;
  controller.abort();
  await rejected;
  assert.equal(state.definitions.plainCell.isLoaded, false);
  provider.reject(new Error('Late category provider failure remains observed'));
  const retry = await state.types.load(state.module, state.specs.valuetypePlain);
  assert.equal(retry.kind, TypeKind.ValueType);
  assert.equal(retry.baseType, state.types.intrinsic('System.ValueType'));
});


test('CLR a plain nominal TypeRef signature activates the independent wait before the external handle arrives', async () => {
  const controller = new AbortController();
  const started = deferred();
  const provider = deferred();
  let late;
  const state = await categoryFixture(({ signal, own }) => {
    if (signal === controller.signal) {
      late = own;
      started.resolve();
      return provider.promise;
    }
    return own;
  });
  const pending = state.types.load(state.module, state.specs.reference, { signal: controller.signal });
  const rejected = assert.rejects(pending, error => error.code === LoadErrorCode.Cancelled);
  await started.promise;
  controller.abort();
  await rejected;
  provider.resolve(late);
  assert.equal(await state.types.load(state.module, state.specs.reference), state.types.intrinsic('System.ValueType'));
  assert.equal(state.calls(), 2);
});
