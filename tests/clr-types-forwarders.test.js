import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { forwardingImage, forwardingTarget, forwardingCorpus, forwardingContext } from './clr-forwarders-fixtures.js';

test('facade and nested ExportedType chains resolve canonical definitions without executable body reads', async () => {
  const context = forwardingContext();
  const facade = await context.loadFromAssemblyName('ForwardFacade');
  for (const [name, token] of [['Widget', 0x02000003], ['Outer', 0x02000004], ['Outer+Inner', 0x02000005]]) {
    const type = await context.types.find(facade.manifestModule, `Fixture.${name}`);
    const target = await context.loadFromAssemblyName('ForwardTarget');
    assert.equal(type, target.manifestModule.typeDefinition(token));
    assert.equal(type, await context.types.find(facade.manifestModule, `Fixture.${name}`));
  }
  assert.deepEqual(context.assemblies.map(assembly => assembly.identity.name), ['ForwardFacade', 'ForwardBridge', 'ForwardTarget']);
  assert.ok(context.assemblies.every(assembly => assembly.manifestModule.methodBodyReadCount === 0));
  const consumer = await context.loadFromAssemblyName('ForwardConsumer');
  const inner = await context.types.load(consumer.manifestModule, 0x01000004);
  assert.equal(inner.fullName, 'Fixture.Outer+Inner');
  assert.equal(inner, await context.types.find(facade.manifestModule, inner.fullName));
  const outerOnly = await context.loadFromAssemblyName('OuterOnly');
  assert.equal(inner, await context.types.find(outerOnly.manifestModule, inner.fullName));
});

test('concurrent forwarder resolutions share load contexts and preserve cross-context descriptor identity after unload', async () => {
  const images = forwardingCorpus();
  const loads = [];
  const context = forwardingContext(images, { load: async request => {
    loads.push(request.assemblyName.name);
    await Promise.resolve();
    return images.get(request.assemblyName.name) ?? null;
  } });
  const facade = await context.loadFromAssemblyName('ForwardFacade');
  const results = await Promise.all(Array.from({ length: 8 }, () => context.types.find(facade.manifestModule, 'Fixture.Widget')));
  assert.ok(results.every(type => type === results[0]));
  assert.deepEqual(loads, ['ForwardFacade', 'ForwardBridge', 'ForwardTarget']);

  const shared = await context.loadFromAssemblyName('ForwardTarget');
  const isolated = forwardingContext(images, { isCollectible: true,
    load: request => request.assemblyName.name === 'ForwardTarget' ? shared : images.get(request.assemblyName.name) ?? null });
  const bridge = await isolated.loadFromAssemblyName('ForwardBridge');
  assert.equal(await isolated.types.find(bridge.manifestModule, 'Fixture.Widget'), results[0]);
  isolated.unload();
  assert.equal(await isolated.types.find(bridge.manifestModule, 'Fixture.Widget'), results[0]);
});

test('forwarder cycles, missing names and unsupported linked netmodules fail explicitly', async () => {
  const context = forwardingContext();
  const cycle = await context.loadFromAssemblyName('CycleA');
  await assert.rejects(context.types.find(cycle.manifestModule, 'Fixture.Widget'), error => {
    assert.equal(error.code, LoadErrorCode.TypeLoad);
    assert.equal(error.managedType, 'System.TypeLoadException');
    assert.match(error.message, /CycleA -> CycleB -> CycleA/);
    return true;
  });
  const facade = await context.loadFromAssemblyName('ForwardFacade');
  await assert.rejects(context.types.find(facade.manifestModule, 'Fixture.Missing'), /Fixture.Missing.*ForwardFacade/);
  const linked = forwardingImage('LinkedFacade', 'ForwardTarget', { decorate(md) {
    const file = md.add(38, [0, md.string('part.netmodule'), 0]);
    md.rows[39][0][0] = 1;
    md.rows[39][0][4] = (file & 0xffffff) * 4;
  } });
  const linkedModule = (await context.loadFromStream(linked)).manifestModule;
  await assert.rejects(context.types.find(linkedModule, 'Fixture.Widget'), /requires linked netmodule loading/);
});

test('forwarder metadata rejects malformed flags, nested scopes, duplicate names and nested ownership cycles', async () => {
  const variants = [
    { exports: [{ name: 'Widget', flags: 0 }], error: /missing its Forwarder flag/ },
    { exports: [{ name: 'Outer' }, { name: 'Inner', parent: 1 }], error: /empty namespace/ },
    { exports: [{ name: 'Widget' }, { name: 'Widget' }], error: /Duplicate ExportedType/ },
    { exports: [{ name: 'One', namespace: '', parent: 2 }, { name: 'Two', namespace: '', parent: 1 }], error: /Circular nested/ },
  ];
  for (const variant of variants) {
    const context = forwardingContext();
    const module = (await context.loadFromStream(forwardingImage('Malformed', 'ForwardTarget', variant))).manifestModule;
    await assert.rejects(context.types.find(module, 'Fixture.Widget'), error => {
      assert.equal(error.code, LoadErrorCode.InvalidImage);
      assert.match(error.message, variant.error);
      return true;
    });
  }
});

test('forwarder hop, row, nested-depth and heap limits are enforced before unbounded expansion', async () => {
  const bounded = forwardingContext(undefined, { typeOptions: { maxForwarderHops: 1 } });
  const facade = await bounded.loadFromAssemblyName('ForwardFacade');
  await assert.rejects(bounded.types.find(facade.manifestModule, 'Fixture.Widget'), /hop limit exceeded/);
  const bridge = await bounded.loadFromAssemblyName('ForwardBridge');
  assert.equal((await bounded.types.find(bridge.manifestModule, 'Fixture.Widget')).assembly.identity.name, 'ForwardTarget');
  await assert.rejects(bounded.types.find(facade.manifestModule, 'Fixture.Widget'), /hop limit exceeded/);
  const rows = forwardingContext(undefined, { typeOptions: { maxMetadataRows: 3 } });
  const rowModule = (await rows.loadFromAssemblyName('ForwardFacade')).manifestModule;
  await assert.rejects(rows.types.find(rowModule, 'Fixture.Widget'), /ExportedType metadata row limit/);
  const nested = forwardingContext(undefined, { typeOptions: { maxDepth: 2 } });
  const nestingImage = forwardingImage('Deep', 'ForwardTarget', { exports: [
    { name: 'Outer' }, { name: 'Inner', namespace: '', parent: 1 }, { name: 'Deep', namespace: '', parent: 2 },
  ] });
  const nestedModule = (await nested.loadFromStream(nestingImage)).manifestModule;
  await assert.rejects(nested.types.find(nestedModule, 'Fixture.Outer'), /Nested ExportedType depth exceeded/);
  const large = forwardingContext();
  const largeModule = (await large.loadFromStream(forwardingImage('Large', 'ForwardTarget', {
    exports: [{ name: 'x'.repeat(16385) }],
  }))).manifestModule;
  await assert.rejects(large.types.find(largeModule, 'Fixture.Widget'), error => error.code === LoadErrorCode.LimitExceeded);
  assert.throws(() => forwardingContext(undefined, { typeOptions: { maxForwarderHops: 0 } }),
    error => error.code === LoadErrorCode.InvalidConfiguration);
});

test('cancelled and failed forwarder lookups do not poison success caches', async () => {
  const controller = new AbortController();
  let cancel = true;
  const context = forwardingContext(new Map(), { load: () => {
    if (cancel) controller.abort();
    return forwardingTarget();
  } });
  const module = (await context.loadFromStream(forwardingImage('Cancellable', 'ForwardTarget'))).manifestModule;
  await assert.rejects(context.types.find(module, 'Fixture.Widget', { signal: controller.signal }),
    error => error.code === LoadErrorCode.Cancelled);
  cancel = false;
  const result = await context.types.find(module, 'Fixture.Widget');
  await assert.rejects(context.types.find(module, 'Fixture.Widget', { signal: AbortSignal.abort() }),
    error => error.code === LoadErrorCode.Cancelled);
  assert.equal(await context.types.find(module, 'Fixture.Widget'), result);

  const images = new Map();
  const missing = forwardingContext(images);
  const absent = (await missing.loadFromStream(forwardingImage('Missing', 'ForwardTarget'))).manifestModule;
  await assert.rejects(missing.types.find(absent, 'Fixture.Widget'), error => error.code === LoadErrorCode.MissingAssembly);
  images.set('ForwardTarget', forwardingTarget());
  assert.equal((await missing.types.find(absent, 'Fixture.Widget')).fullName, 'Fixture.Widget');
});
