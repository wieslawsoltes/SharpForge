import { createMetadataVerificationTypeSystem as create } from '@sharpforge/cil';
import { coreAuthority, externalFixture } from './input.js';

/** Focused browser contract, shared real metadata fixtures and package entry points only. */
export function run() {
  let checks = 0;
  function equal(actual, expected, label) {
    if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
    checks++;
  }
  function failure(operation, code) {
    let error;
    try { operation(); } catch (caught) { error = caught; }
    equal(error?.code, code, 'diagnostic');
  }
  const core = coreAuthority();
  const localCore = create(core.inspect(), { coreTypes: core.coreTypes });
  const category = (adapter, token) => adapter.typeCategory(adapter.resolveType(token).value);
  for (const [name, expected] of [['Root', 'reference'], ['ValueRoot', 'reference'], ['EnumRoot', 'reference'],
    ['Struct', 'value'], ['Enum', 'enum'], ['Interface', 'reference']]) {
    equal(category(localCore, core.tokens[name]).value, expected, name);
  }
  const input = externalFixture(core);
  const adapter = create(input.inspect(), { coreTypes: input.coreTypes, maxQueryNodes: 4, maxDepth: 3 });
  for (const [name, expected] of [['LocalClass', 'reference'], ['LocalDerived', 'reference'],
    ['LocalValue', 'value'], ['LocalEnum', 'enum'], ['LocalInterface', 'reference']]) {
    equal(category(adapter, input.tokens[name]).value, expected, name);
  }
  equal(adapter.resolveType(input.tokens.Root).status, 'unknown', 'foreign token');
  equal(category(create(input.inspect()), input.tokens.LocalValue).status, 'unknown', 'unbound category');
  equal(localCore.resolveType(core.tokens.Open).status, 'unknown', 'generic definition');
  equal(Object.isFrozen(adapter.resolveType(input.tokens.LocalValue).value), true, 'immutable identity');
  failure(() => adapter.typeCategory(core.coreTypes.object), 'CILVT0004');
  failure(() => create(input.inspect(), { coreTypes: input.coreTypes, maxQueryNodes: 3 }), 'CILVT0002');
  failure(() => create(input.inspect(), { coreTypes: input.coreTypes, maxDepth: 2 }), 'CILVT0002');
  const controller = new AbortController();
  const live = create(input.inspect(), { coreTypes: input.coreTypes, signal: controller.signal });
  const type = live.resolveType(input.tokens.LocalClass).value;
  controller.abort();
  failure(() => live.typeCategory(type), 'CILVT0003');
  failure(() => create(input.inspect(), { coreTypes: input.coreTypes, signal: controller.signal }), 'CILVT0003');
  return { passed: true, checks };
}
