import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetadataVerificationTypeSystem as create } from '@sharpforge/cil';
import { coreAuthority, externalFixture } from './fixtures/a03-type-categories/input.js';

const fails = code => error => error.code === code;
function input() {
  const core = coreAuthority();
  const local = externalFixture(core);
  local.definition('Unrelated', local.tokens.Root);
  return { core, local };
}
function relation(local, options = {}) {
  const adapter = create(local.inspect(), { coreTypes: { ...local.coreTypes, ...options } });
  const resolve = name => adapter.resolveType(local.tokens[name]).value;
  return { adapter, resolve };
}

test('only an explicit different-module complete class path closes missing local ancestry', () => {
  const { local } = input();
  for (const sameModule of [undefined, true, false]) {
    const { adapter, resolve } = relation(local, { sameModule });
    const result = adapter.isAssignable(resolve('LocalDerived'), resolve('Unrelated'));
    assert.equal(result.status, sameModule === false ? 'known' : 'unknown');
    if (sameModule === false) assert.equal(result.value, false);
    assert.equal(adapter.isAssignable(resolve('LocalDerived'), resolve('LocalClass')).value, true);
    assert.equal(adapter.baseType(resolve('LocalClass')).status, 'unknown');
    assert.equal(adapter.resolveType(local.tokens.Class).status, 'unknown');
  }
});

test('closed class paths never claim absent interfaces or an unknown core class path', () => {
  const { core, local } = input();
  const { adapter, resolve } = relation(local, { sameModule: false });
  assert.equal(adapter.isAssignable(resolve('LocalDerived'), resolve('LocalInterface')).status, 'unknown');
  const context = { ...core.context, baseType(type) {
    return type.token === core.tokens.Class ? { status: 'unknown', reason: 'unprepared-parent' } : core.context.baseType(type);
  } };
  const missing = relation(local, { sameModule: false, context });
  assert.equal(missing.adapter.typeCategory(missing.resolve('LocalClass')).status, 'unknown');
  assert.equal(missing.adapter.isAssignable(missing.resolve('LocalClass'), missing.resolve('Unrelated')).status, 'unknown');
});

test('module relation is a validated trusted fact and cannot contradict canonical local definition bindings', () => {
  const { core, local } = input();
  for (const sameModule of [null, 0, 1, 'false', {}])
    assert.throws(() => relation(local, { sameModule }), fails('CILVT0001'));
  const authority = { ...core.coreTypes, sameModule: false };
  assert.throws(() => create(core.inspect(), { coreTypes: authority }), fails('CILVT0001'));
  const adapter = create(core.inspect(), { coreTypes: { ...authority, sameModule: true } });
  assert.equal(adapter.typeCategory(adapter.resolveType(core.tokens.Root).value).status, 'known');
});

test('closed ancestry facts are snapshotted and preserve existing depth/query/cancellation budgets', () => {
  const { local } = input();
  const coreTypes = { ...local.coreTypes, sameModule: false };
  const controller = new AbortController();
  const adapter = create(local.inspect(), { coreTypes, signal: controller.signal });
  const source = adapter.resolveType(local.tokens.LocalDerived).value;
  const target = adapter.resolveType(local.tokens.Unrelated).value;
  coreTypes.sameModule = true;
  local.bindings.clear();
  assert.equal(adapter.isAssignable(source, target).value, false);
  controller.abort();
  assert.throws(() => adapter.isAssignable(source, target), fails('CILVT0003'));
  const fresh = input().local;
  for (const limits of [{ maxDepth: 2 }, { maxQueryNodes: 3 }])
    assert.throws(() => create(fresh.inspect(), { coreTypes: { ...fresh.coreTypes, sameModule: false }, ...limits }), fails('CILVT0002'));
});
