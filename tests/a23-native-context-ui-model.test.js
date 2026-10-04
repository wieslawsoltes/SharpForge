import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeUiModelFixture } from './support/a23-native-ui-model.js';
import { defaultNativeSettings, nativeBuildRequest } from '../apps/studio/native-build/settings.js';

test('native context model hydrates exact ordinary/generated sources and metadata before selection', async () => {
  const { host, model, contexts, calls, commits } = nativeUiModelFixture();
  const initial = await model.load();
  const first = model.compilation;
  assert.deepEqual(first.files.map(file => file.uri), ['App/One.cs', 'App/obj/net8.0/GlobalUsings.g.cs']);
  assert.equal(first.options.nullable, 'enable');
  assert.equal(first.options.langVersion, '12');
  assert.equal(first.options.allowUnsafe, true);
  assert.equal(first.options.checkOverflow, true);
  assert.deepEqual([...first.options.references[0].bytes], [1, 2, 3]);
  assert.equal(first.files[0].hash, 'hash:App/One.cs');
  assert.equal(first.files[0].readOnly, false);
  assert.equal(first.files[1].readOnly, true);
  assert.equal(first.files[1].generated, true);
  assert.equal(initial.sourceCount, 2);
  assert.equal(initial.referenceCount, 1);
  assert.equal(commits[0].context, contexts[0]);

  await model.select(contexts[1].id);
  assert.deepEqual(model.compilation.files.map(file => file.uri), ['App/Ten.cs', 'App/obj/net10.0/GlobalUsings.g.cs']);
  assert.equal(host.settings.framework, 'net10.0');
  assert.equal(model.diagnostics[0].targetFramework, 'net10.0');
  assert.equal(calls.filter(call => call.kind === 'contexts').length, 1);
  assert.equal(calls.filter(call => call.kind === 'metadata').at(-1).request.framework, 'net10.0');
  assert.equal(commits.length, 2);
});

test('failed source reads and cancellation preserve the last complete native model selection', async () => {
  const { host, model, contexts, commits, cancel } = nativeUiModelFixture();
  await model.load();
  const previous = model.compilation;
  const selected = model.active;
  const read = host.client.read;
  host.client.read = async path => {
    if (path === 'App/Ten.cs') throw new Error('Read refused');
    return read(path);
  };
  await assert.rejects(model.select(contexts[1].id), /Read refused/);
  assert.equal(model.compilation, previous);
  assert.equal(model.active, selected);
  host.client.read = async path => {
    if (path === 'App/Ten.cs') cancel();
    return read(path);
  };
  await assert.rejects(model.select(contexts[1].id), { name: 'AbortError' });
  assert.equal(model.compilation, previous);
  assert.equal(model.active, selected);
  assert.equal(commits.length, 1);
  assert.equal(host.controller, null);
});

test('changing projects while a context read is held prevents the old generation from activating', async () => {
  const { host, model, contexts, calls, commits } = nativeUiModelFixture();
  await model.load();
  const read = host.client.read;
  let resume;
  let announce;
  const held = new Promise(resolve => { resume = resolve; });
  const started = new Promise(resolve => { announce = resolve; });
  host.client.read = async path => {
    if (path === 'App/Ten.cs') { announce(); await held; }
    return read(path);
  };
  const loading = model.select(contexts[1].id);
  await started;
  model.setProject('Other/Other.csproj');
  resume();
  await assert.rejects(loading, /Native context changed while loading/);
  assert.equal(model.project, 'Other/Other.csproj');
  assert.equal(model.active, null);
  assert.equal(model.compilation, null);
  assert.equal(commits.length, 1);
  assert.equal(calls.filter(call => call.kind === 'reset-profiles').length, 1);
  assert.throws(() => model.setProject('Missing.csproj'), /connected workspace/);
  assert.equal(model.project, 'Other/Other.csproj');
});

test('native context requests preserve explicit advanced argv and reject non-vector input', () => {
  const settings = {
    ...defaultNativeSettings(), project: 'App/App.csproj', arguments: '["-flag:two words","literal"]',
    properties: 'Mode=Test\nFeature=true', targets: 'Build;Inspect', resultTargets: 'Inspect,Report'
  };
  const request = nativeBuildRequest(settings, 'evaluate');
  assert.deepEqual(request.arguments, ['-flag:two words', 'literal']);
  assert.equal(Object.getPrototypeOf(request.properties), null);
  assert.deepEqual({ ...request.properties }, { Mode: 'Test', Feature: 'true' });
  assert.deepEqual(request.targets, ['Build', 'Inspect']);
  assert.deepEqual(request.resultTargets, ['Inspect', 'Report']);
  assert.equal(request.action, 'evaluate');
  assert.throws(() => nativeBuildRequest({ ...settings, arguments: '{"flag":true}' }, 'build'), /JSON string array/);
  assert.throws(() => nativeBuildRequest({ ...settings, arguments: '[1]' }, 'build'), /JSON string array/);
});
