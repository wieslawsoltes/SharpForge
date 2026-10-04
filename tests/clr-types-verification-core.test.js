import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, createMetadataVerificationTypeSystem } from '@sharpforge/cil';
import { prepareVerificationCoreTypes, LoadErrorCode } from '../packages/clr/src/index.js';
import { coreBindingFixture, inputBindingImage } from './helpers/clr-verification-core-types.js';

const fails = code => error => error.code === code;

test('CLR binding supplies canonical CIL core handles without changing local verifier identities', async () => {
  const { module, input, coreModule, types, bindingOptions } = await coreBindingFixture();
  const authority = await prepareVerificationCoreTypes(module, bindingOptions);
  assert.ok(Object.isFrozen(authority));
  assert.equal(authority.context, types);
  for (const role of ['object', 'valueType', 'enum']) {
    const result = authority.resolveType(input.tokens[role]);
    assert.equal(result.value, bindingOptions[role]);
    assert.ok(Object.isFrozen(result));
    assert.equal(result, authority.resolveType(input.tokens[role]));
  }
  const local = createMetadataVerificationTypeSystem(new AssemblyInspector(input.bytes), { coreTypes: authority });
  for (const [role, category] of [['object', 'reference'], ['valueType', 'value'], ['enum', 'enum']]) {
    const child = local.resolveType(input.tokens[`${role}Child`]).value;
    assert.equal(local.typeCategory(child).value, category);
    assert.equal(local.resolveType(input.tokens[role]).status, 'unknown');
    assert.notEqual(child, bindingOptions[role]);
  }
  assert.equal(module.methodBodyReadCount, 0);
  assert.equal(coreModule.methodBodyReadCount, 0);
});

test('core-module TypeDefs can establish fundamental roots through the same authority contract', async () => {
  const { coreModule, core, bindingOptions } = await coreBindingFixture();
  const authority = await prepareVerificationCoreTypes(coreModule, { ...bindingOptions,
    tokens: [core.tokens.object, core.tokens.valueType, core.tokens.enum] });
  const local = createMetadataVerificationTypeSystem(new AssemblyInspector(core.bytes), { coreTypes: authority });
  for (const role of ['object', 'valueType', 'enum', 'ordinary']) {
    assert.equal(local.typeCategory(local.resolveType(core.tokens[role]).value).value, 'reference');
  }
  assert.equal(local.typeCategory(local.resolveType(core.tokens.value).value).value, 'value');
});

test('unprepared, non-core and open definitions remain unknown without assembly-name or token aliasing', async () => {
  const { module, coreModule, otherModule, input, core, bindingOptions } = await coreBindingFixture();
  const authority = await prepareVerificationCoreTypes(module, { ...bindingOptions,
    tokens: [input.tokens.object, input.tokens.other, input.tokens.open] });
  assert.equal(authority.resolveType(input.tokens.other).reason, 'outside-core-module');
  assert.equal(authority.resolveType(input.tokens.open).reason, 'generic-definition');
  assert.equal(authority.resolveType(input.tokens.missing).reason, 'unprepared-core-binding');
  assert.ok(Object.isFrozen(authority.resolveType(input.tokens.missing)));
  assert.equal(authority.resolveType(input.tokens.missing), authority.resolveType(input.tokens.valueType));
  const differentModule = await prepareVerificationCoreTypes(otherModule, { ...bindingOptions, tokens: [core.tokens.object] });
  assert.equal(differentModule.resolveType(core.tokens.object).reason, 'outside-core-module');
  const coreAuthority = await prepareVerificationCoreTypes(coreModule, { ...bindingOptions, tokens: [core.tokens.object] });
  assert.equal(coreAuthority.resolveType(core.tokens.object).value, bindingOptions.object);
});

test('the prepared lookup owns the token selection and bounded result records', async () => {
  const fixture = await coreBindingFixture({ isCollectible: true });
  const tokens = [fixture.input.tokens.object, fixture.input.tokens.object];
  const pending = prepareVerificationCoreTypes(fixture.module, { ...fixture.bindingOptions, tokens });
  tokens.fill(fixture.input.tokens.missing);
  tokens.push(fixture.input.tokens.other);
  const authority = await pending;
  assert.equal(authority.resolveType(fixture.input.tokens.object).value, fixture.bindingOptions.object);
  assert.equal(authority.resolveType(fixture.input.tokens.other).reason, 'unprepared-core-binding');
  assert.throws(() => { authority.object = null; }, TypeError);
  assert.throws(() => { authority.resolveType(fixture.input.tokens.object).value.flags = 0; }, TypeError);
  fixture.context.unload();
  assert.equal(authority.resolveType(fixture.input.tokens.object).value, fixture.bindingOptions.object);
});

test('host intrinsic descriptors cannot impersonate the declared metadata core module', async () => {
  let intrinsic;
  const fixture = await coreBindingFixture({ typeOptions: { resolveExternalType: () => intrinsic } });
  intrinsic = fixture.context.types.defineIntrinsic('Authority.Root');
  const authority = await prepareVerificationCoreTypes(fixture.module, { ...fixture.bindingOptions,
    tokens: [fixture.input.tokens.object] });
  assert.equal(authority.resolveType(fixture.input.tokens.object).reason, 'outside-core-module');
});

test('invalid or oversized preparation rejects before resolving any input reference', async () => {
  let calls = 0;
  const { module, bindingOptions, input, types } = await coreBindingFixture({
    typeOptions: { resolveExternalType() { calls++; return null; } },
  });
  for (const maxBindings of [-1, 65536, 0.5, NaN]) {
    await assert.rejects(prepareVerificationCoreTypes(module, { ...bindingOptions, maxBindings }), fails(LoadErrorCode.InvalidConfiguration));
  }
  await assert.rejects(prepareVerificationCoreTypes(module, { ...bindingOptions, maxBindings: 2 }), fails(LoadErrorCode.LimitExceeded));
  for (const token of [0, -1, 1.5, 0x100000000, 0x06000001, 0x0100ffff, {}, 1n]) {
    await assert.rejects(prepareVerificationCoreTypes(module, { ...bindingOptions, tokens: [input.tokens.object, token] }),
      fails(LoadErrorCode.InvalidConfiguration));
  }
  for (const options of [null, {}, { ...bindingOptions, tokens: new Set() }, { ...bindingOptions, coreModule: {} },
    { ...bindingOptions, object: { ...bindingOptions.object } }, { ...bindingOptions, enum: bindingOptions.object },
    { ...bindingOptions, context: { ...types, resolveType: async () => ({ status: 'known', value: bindingOptions.object }) } }]) {
    await assert.rejects(prepareVerificationCoreTypes(module, options), fails(LoadErrorCode.InvalidConfiguration));
  }
  const empty = await prepareVerificationCoreTypes(module, { ...bindingOptions, tokens: [], maxBindings: 0 });
  assert.equal(empty.resolveType(input.tokens.object).reason, 'unprepared-core-binding');
  assert.equal(calls, 0);
});

test('missing assemblies and malformed type metadata propagate loader diagnostics', async () => {
  const { module, input, bindingOptions, context } = await coreBindingFixture();
  await assert.rejects(prepareVerificationCoreTypes(module, { ...bindingOptions, tokens: [input.tokens.missing] }),
    fails(LoadErrorCode.MissingAssembly));
  const malformed = inputBindingImage('BrokenBindingInput', { cyclic: true });
  const broken = (await context.loadFromStream(malformed.bytes)).manifestModule;
  await assert.rejects(prepareVerificationCoreTypes(broken, { ...bindingOptions, tokens: [malformed.tokens.object] }),
    error => error.code === LoadErrorCode.TypeLoad && /Circular TypeRef/.test(error.message));
});

test('cancellation before and during asynchronous binding never publishes a partial authority', async () => {
  const before = await coreBindingFixture();
  await assert.rejects(prepareVerificationCoreTypes(before.module, { ...before.bindingOptions, signal: AbortSignal.abort() }),
    fails(LoadErrorCode.Cancelled));
  const controller = new AbortController();
  const during = await coreBindingFixture({ typeOptions: { resolveExternalType() { controller.abort(); return null; } } });
  await assert.rejects(prepareVerificationCoreTypes(during.module, { ...during.bindingOptions, signal: controller.signal }),
    fails(LoadErrorCode.Cancelled));
});
