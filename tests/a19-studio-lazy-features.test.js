import test from 'node:test';
import assert from 'node:assert/strict';
import { LazyTools } from '../apps/studio/workbench/lazy-tools.js';
import { LazyFeature } from '../apps/studio/workbench/lazy-features/feature.js';
import { createStudioLazyFeatures } from '../apps/studio/workbench/lazy-features/index.js';
import { hasLocalHostCapability } from '../apps/studio/workbench/lazy-features/native-settings.js';
import { contributeDesignerAutomation } from '../apps/studio/tools/designer-automation.js';
import { context, controllerModules, deferred, element, settle } from './support/a19-lazy-features.js';

test('cold Studio registers every facade without importing tools or activating native integration', async () => {
  const fixture = controllerModules(), environment = context();
  const features = createStudioLazyFeatures(environment, { modules: new LazyTools(fixture.loaders) });
  assert.equal(features.peek('designer'), null);
  assert.deepEqual(features.native.sourceChanges(), []);
  assert.equal(features.native.snapshot().connected, false);
  assert.equal(features.native.busy, false);
  assert.equal(features.native.client, null);
  assert.equal(features.native.attached, false);
  features.designer.sourceSync.sourceChanged('file.cs');
  features.disassembly.reset();
  await features.native.cancel();
  for (const hash of ['', '#unrelated=value', '#sharpforge-token=']) {
    assert.equal(await features.native.autoConnect({ hash }), false);
  }
  await settle();
  assert.deepEqual(fixture.loaded, []);
  assert.deepEqual(fixture.created, []);
  features.dispose();
  assert.equal(environment.test.listeners.size, 0);
});

test('first commands and panels instantiate each actual controller once and share native settings', async () => {
  const fixture = controllerModules(), environment = context();
  const features = createStudioLazyFeatures(environment, { modules: new LazyTools(fixture.loaders) });
  features.native.settings.configuration = 'Release';
  features.native.buffers.set('source.cs', { text: 'edited' });
  await Promise.all([features.designer.ensure(), features.designer.ensure()]);
  await environment.test.commands.get('designer').execute();
  assert.deepEqual(environment.docking.resets, ['designer']);
  assert.equal(environment.state.panel, 'designer');
  assert.equal(await features.assembly.open(new Uint8Array([1, 2])), 'opened');
  environment.test.show('disassembly');
  environment.test.show('project-source');
  assert.equal(await features.wizard.openProject(), 'project');
  assert.equal(await features.wizard.openItem(), 'item');
  assert.equal(await features.wizard.selectImport(), 'import');
  await settle();
  assert.deepEqual([...fixture.loaded].sort(), ['assembly', 'designer', 'disassembly', 'msbuild', 'wizard']);
  assert.equal(fixture.created.length, 5);
  const native = features.peek('msbuild');
  assert.equal(native.settings, features.native.settings);
  assert.equal(native.buffers, features.native.buffers);
  assert.equal(native.settings.configuration, 'Release');
  assert.equal(native.buffers.get('source.cs').text, 'edited');
  features.native.attached = true;
  assert.equal(features.native.attached, true);
  features.dispose();
  assert.equal(fixture.calls.filter(([method]) => method === 'dispose').length, 5);
});

test('visible restored panels activate only their feature and repeated layout events do not rerender', async () => {
  const fixture = controllerModules(), environment = context();
  environment.test.show('assembly');
  const features = createStudioLazyFeatures(environment, { modules: new LazyTools(fixture.loaders) });
  await settle();
  assert.deepEqual(fixture.loaded, ['assembly']);
  assert.equal(fixture.rendered.length, 1);
  environment.test.refresh();
  environment.test.refresh();
  assert.equal(fixture.rendered.length, 1);
  environment.test.show('output');
  environment.test.show('assembly');
  assert.equal(fixture.rendered.length, 2);
  const detached = element();
  detached.isConnected = false;
  environment.test.show('designer', detached);
  await settle();
  assert.deepEqual(fixture.loaded, ['assembly']);
  features.dispose();
});

test('loading coalesces latest mount and disposal prevents late construction or DOM changes', async () => {
  const loading = deferred();
  let constructed = 0, renders = 0;
  const feature = new LazyFeature({ id: 'tool', title: 'Tool', modules: new LazyTools({ tool: () => loading.promise }),
    create: () => { constructed++; return {}; } });
  const first = element(), latest = element();
  feature.mount('panel', first, () => { throw new Error('Stale panel rendered'); });
  feature.mount('panel', latest, () => { renders++; });
  loading.resolve({});
  await settle();
  assert.equal(constructed, 1);
  assert.equal(renders, 1);
  assert.equal(latest.attributes.has('aria-busy'), false);
  feature.dispose();
  const pending = deferred(), cancelled = element();
  const disposed = new LazyFeature({ id: 'tool', title: 'Tool', modules: new LazyTools({ tool: () => pending.promise }),
    create: () => { throw new Error('Disposed feature constructed'); } });
  disposed.mount('panel', cancelled, () => { throw new Error('Disposed panel rendered'); });
  const original = cancelled.children;
  disposed.dispose();
  pending.resolve({});
  await settle();
  assert.equal(cancelled.children, original);
  await assert.rejects(disposed.load(), /disposed/);
});

test('module failure presents an actionable retry and a successful retry mounts the real controller', async () => {
  let attempts = 0, renders = 0;
  const errors = [], target = element();
  const feature = new LazyFeature({ id: 'tool', title: 'Tool', onError: error => errors.push(error),
    modules: new LazyTools({ tool: () => { if (++attempts === 1) throw new Error('Unavailable'); return {}; } }),
    create: () => ({ render: () => { renders++; } }) });
  feature.mount('panel', target, tools => tools.render());
  await settle();
  assert.match(target.children[0].textContent, /Unavailable/);
  assert.equal(target.children[1].textContent, 'Retry');
  target.children[1].onclick();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(renders, 1);
  assert.equal(errors.length, 1);
  feature.dispose();
});

test('capability presence permits only native first activation; canonical client still validates the token', async () => {
  assert.equal(hasLocalHostCapability({ hash: '#sharpforge-token=' }), false);
  assert.equal(hasLocalHostCapability({ hash: '#sharpforge-token=' + 'a'.repeat(64) }), true);
  const fixture = controllerModules(), environment = context();
  const features = createStudioLazyFeatures(environment, { modules: new LazyTools(fixture.loaders) });
  assert.equal(await features.native.autoConnect({ hash: '#sharpforge-token=' + 'a'.repeat(64) }), true);
  assert.deepEqual(fixture.loaded, ['msbuild']);
  assert.equal(fixture.calls.at(-1)[0], 'autoConnect');
  features.dispose();
});

test('designer automation waits for first activation and preserves synchronous loaded document calls', async () => {
  const ready = deferred(), calls = [];
  let actual = null, api;
  const tools = { ensure: () => calls.push('ensure'), replace: value => calls.push(value), snapshot: () => ({ version: 7 }),
    document: { select: ids => ids } };
  contributeDesignerAutomation({ contributeAutomation: (_, value) => { api = value.designer; } },
    { loadDesigner: () => actual ?? ready.promise, execute: id => calls.push(id) });
  const pending = api.load({ nodes: [] });
  assert.deepEqual(calls, []);
  actual = tools;
  ready.resolve(tools);
  assert.deepEqual(await pending, { version: 7 });
  assert.deepEqual(calls, ['ensure', { nodes: [] }]);
  assert.deepEqual(api.get(), { version: 7 });
  assert.deepEqual(api.select(['node1']), ['node1']);
  api.open();
  assert.equal(calls.at(-1), 'designer');
});
