import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeContextMarkup, bindNativeContextView, updateNativeContextControls } from '../apps/studio/native-build/context-view.js';
import { renderNativeBuild } from '../apps/studio/native-build/build-view.js';
import { renderNativeSource, renderNativeTree } from '../apps/studio/native-build/source-view.js';
import { renderNativeInspector } from '../apps/studio/native-build/inspector-view.js';
import { NativeViewElement, nativeViewHost, nativeContextElement, nativeBuildElement,
  nativeSourceElement } from './support/a23-native-view-host.js';

test('native context markup escapes values and displays at most 100 diagnostics without executing host actions', () => {
  const { host, calls } = nativeViewHost();
  host.workspace.projects = ['<App>&.csproj'];
  host.contexts.active = { id: '<context>', configuration: '<Debug>', platform: 'AnyCPU', targetFramework: 'net10.0' };
  host.contexts.contexts = [host.contexts.active];
  host.contexts.compilation = { files: [{}, {}], references: [{}] };
  host.contexts.diagnostics = Array.from({ length: 101 }, (_, index) => ({ code: 'D' + index, message: '<message>' }));
  host.profiles.launch = { profiles: [{ name: '<Launch>', commandName: 'Project', args: ['one'],
    environmentVariables: { TOKEN: 'secret-value' } }] };
  host.profiles.launchProfile = '<Launch>';
  host.profiles.publish = [{ name: '<Publish>', properties: { PublishDir: { value: '<output>&', evaluated: false } } }];
  host.profiles.publishProfile = '<Publish>';
  const markup = nativeContextMarkup(host);
  assert.match(markup, /&lt;App&gt;&amp;\.csproj/);
  assert.match(markup, /&lt;Debug&gt;/);
  assert.match(markup, /2 sources · 1 metadata references/);
  assert.match(markup, /1 argument\(s\) · 1 environment variable\(s\)/);
  assert.match(markup, /&lt;output&gt;&amp; \(requires native evaluation\)/);
  assert.equal((markup.match(/data-native-context-diagnostic/g) ?? []).length, 100);
  assert.doesNotMatch(markup, /<message>|<Launch>|<Publish>|secret-value|>D100</);
  assert.deepEqual(calls, []);
});

test('native context callbacks separate profile inspection from execution and report non-cancellation errors', async () => {
  const { host, calls, errors } = nativeViewHost();
  const element = nativeContextElement();
  bindNativeContextView(host, element);
  await element.querySelector('[data-native-profiles-refresh]').onclick();
  await element.querySelector('[data-native-launch-profile]').onchange({ target: { value: 'Local' } });
  await element.querySelector('[data-native-publish-profile]').onchange({ target: { value: 'Folder' } });
  assert.deepEqual(calls.map(call => call.name), ['readProfiles', 'selectLaunch', 'selectPublish']);
  assert.deepEqual(calls[1].args, ['Local']);
  assert.deepEqual(calls[2].args, ['Folder']);
  await element.querySelector('[data-native-project-run]').onclick();
  await element.querySelector('[data-native-profile-publish]').onclick();
  element.querySelector('[data-native-tests-open]').onclick();
  element.querySelector('[data-native-run-no-build]').onchange({ target: { checked: false } });
  assert.equal(host.profiles.noBuild, false);
  assert.deepEqual(calls.slice(3).map(call => call.name), ['runProject', 'publishProfile', 'panel']);
  assert.deepEqual(calls.at(-1).args, ['tests']);
  host.contexts.load = async () => { throw new Error('Evaluation denied'); };
  await element.querySelector('[data-native-context-load]').onclick();
  assert.deepEqual(errors.map(error => error.message), ['Evaluation denied']);
  host.contexts.load = async () => { throw new DOMException('Cancelled', 'AbortError'); };
  await element.querySelector('[data-native-context-load]').onclick();
  assert.equal(errors.length, 1);
});

test('native context controls retain read-only profile inspection while enforcing busy and SDK availability', () => {
  const { host } = nativeViewHost();
  const element = nativeContextElement();
  const disabled = name => element.querySelector('[data-native-' + name + ']').disabled;
  host.capabilities.available = false;
  updateNativeContextControls(host, element);
  assert.equal(disabled('profiles-refresh'), false);
  assert.equal(disabled('context-load'), true);
  assert.equal(disabled('context-select'), true);
  assert.equal(disabled('project-run'), true);
  assert.equal(disabled('profile-publish'), true);
  host.capabilities.available = true;
  host.contexts.contexts = [{ id: 'selected' }];
  host.profiles.publishProfile = 'Folder';
  updateNativeContextControls(host, element);
  assert.equal(disabled('context-select'), false);
  assert.equal(disabled('profile-publish'), false);
  host.busy = true;
  updateNativeContextControls(host, element);
  assert([...element.nodes.values()].every(control => control.disabled));
  host.busy = false;
  host.workspace = null;
  updateNativeContextControls(host, element);
  assert([...element.nodes.values()].every(control => control.disabled));
});

test('native build view keeps output inert and forwards only the selected diagnostic or artifact', async () => {
  const { host, calls } = nativeViewHost();
  const element = nativeBuildElement();
  host.hosts.set('msbuild', element);
  const artifact = { path: '<Result>.dll', size: 2048 };
  host.job = { request: { action: 'build' }, status: 'succeeded', exitCode: 0, invocation: { args: ['<input>'] },
    diagnostics: [{ severity: 'error', code: '<CODE>', file: '<App>.cs', workspacePath: 'App.cs',
      message: '<script>alert(1)</script>', line: 2, column: 3 }], artifacts: [artifact] };
  host.log = '<script>untrusted output</script>';
  const diagnostic = new NativeViewElement({ dataset: { nativeDiagnostic: '0' } });
  const inspect = new NativeViewElement({ dataset: { nativeInspect: '0' } });
  element.querySelector('.native-diagnostics').groups.set('[data-native-diagnostic]', [diagnostic]);
  element.querySelector('.native-artifacts').groups.set('[data-native-inspect]', [inspect]);
  renderNativeBuild(host);
  assert.equal(element.querySelector('.native-build-output').textContent, host.log);
  assert.equal(element.querySelector('.native-invocation').textContent, JSON.stringify(host.job.invocation, null, 2));
  assert.match(element.querySelector('.native-operation-status').textContent, /BUILD · succeeded · exit 0/);
  assert.match(element.querySelector('.native-diagnostics').innerHTML, /&lt;script&gt;/);
  assert.match(element.querySelector('.native-artifacts').innerHTML, /&lt;Result&gt;\.dll/);
  assert.doesNotMatch(element.querySelector('.native-diagnostics').innerHTML, /<script>/);
  assert.equal(element.querySelector('[data-native-cancel]').disabled, true);
  assert.deepEqual(calls, []);
  diagnostic.onclick();
  await Promise.resolve();
  await inspect.onclick();
  assert.deepEqual(calls, [{ name: 'open', args: ['App.cs', 2, 3] }, { name: 'artifact', args: [artifact, { inspect: true }] }]);
});

test('native build rendering disables unavailable or busy operations and ignores detached panels', () => {
  const { host, calls } = nativeViewHost();
  renderNativeBuild(host);
  renderNativeSource(host);
  renderNativeInspector(host);
  const element = nativeBuildElement();
  host.hosts.set('msbuild', element);
  host.capabilities = { available: false, error: '<missing SDK>' };
  renderNativeBuild(host);
  assert.match(element.innerHTML, /&lt;missing SDK&gt;/);
  assert(element.querySelectorAll('[data-native-action]').every(button => button.disabled));
  assert.equal(element.querySelector('[data-native-connect]').disabled, false);
  host.busy = true;
  renderNativeBuild(host);
  assert(element.querySelectorAll('[data-native-setting]').every(control => control.disabled));
  assert.equal(element.querySelector('[data-native-connect]').disabled, true);
  assert.equal(element.querySelector('[data-native-cancel]').disabled, false);
  assert.deepEqual(calls, []);
});

test('native source view escapes file contents, preserves buffer identity and routes keyboard save', async () => {
  const { host, calls } = nativeViewHost();
  const element = nativeSourceElement();
  host.hosts.set('project-source', element);
  const path = 'App.csproj';
  const buffer = { path, text: '<Project>old</Project>', baseline: '<Project>old</Project>', hash: 'disk-hash' };
  host.workspace.files = [{ path, kind: 'project' }, { path: 'Hidden.cs', kind: 'source' }];
  host.sourcePath = path;
  host.buffers.set(path, buffer);
  renderNativeSource(host);
  assert.match(element.innerHTML, /&lt;Project&gt;old&lt;\/Project&gt;/);
  assert.doesNotMatch(element.innerHTML, /Hidden\.cs/);
  assert.match(element.querySelector('.native-source-status').textContent, /matches loaded disk snapshot/);
  const area = element.querySelector('.native-xml-editor');
  area.value = '<Project>edited</Project>';
  area.oninput();
  assert.equal(host.buffers.get(path), buffer);
  assert.equal(buffer.baseline, '<Project>old</Project>');
  assert.equal(buffer.text, area.value);
  renderNativeSource(host);
  assert.match(element.querySelector('.native-source-status').textContent, /unsaved changes/);
  const events = [];
  const key = { ctrlKey: true, metaKey: false, key: 'S', preventDefault: () => events.push('prevent'),
    stopPropagation: () => events.push('stop') };
  area.listeners.get('keydown')(key);
  await Promise.resolve();
  assert.deepEqual(events, ['prevent', 'stop']);
  assert.deepEqual(calls.map(call => call.name), ['renderSource', 'save']);
  area.listeners.get('keydown')({ ...key, ctrlKey: false });
  await Promise.resolve();
  assert.equal(calls.length, 2);
});

test('native workspace tree filters case-insensitively, escapes paths and caps its rows at 500', async () => {
  const { host, calls } = nativeViewHost();
  const element = new NativeViewElement();
  host.workspace.files = Array.from({ length: 501 }, (_, index) => ({ path: 'Folder/File' + index + '.cs', kind: 'source' }));
  const before = JSON.stringify(host.workspace.files);
  renderNativeTree(host, element);
  assert.equal((element.innerHTML.match(/data-native-file=/g) ?? []).length, 500);
  assert.match(element.innerHTML, /Showing 500 files/);
  renderNativeTree(host, element, 'file500.CS');
  assert.equal((element.innerHTML.match(/data-native-file=/g) ?? []).length, 1);
  assert.match(element.innerHTML, /Folder\/File500\.cs/);
  assert.equal(JSON.stringify(host.workspace.files), before);
  host.workspace.files = [{ path: '<App>&.csproj', kind: 'project' }];
  const button = new NativeViewElement({ dataset: { nativeFile: '<App>&.csproj' } });
  element.groups.set('[data-native-file]', [button]);
  renderNativeTree(host, element);
  assert.match(element.innerHTML, /&lt;App&gt;&amp;\.csproj/);
  assert.deepEqual(calls, []);
  await button.onclick();
  assert.deepEqual(calls, [{ name: 'open', args: ['<App>&.csproj'] }]);
});

test('native inspector renders escaped bounded values and filters without mutation or transport', () => {
  const { host, calls } = nativeViewHost();
  const element = new NativeViewElement();
  const filter = element.node('.native-inspection-filter');
  const content = element.node('.native-evaluation-content');
  host.hosts.set('msbuild-inspector', element);
  renderNativeInspector(host);
  assert.match(element.innerHTML, /Run Evaluate, List targets or Preprocess/);
  host.inspection = { project: '<App>.csproj', action: 'evaluate', result: {
    Properties: { '<Target>': '<unsafe>&' }, Items: { Compile: Array.from({ length: 501 }, (_, index) => ({ Identity: 'Item' + index })) },
    preprocessedText: '<Project />', TargetResults: { Build: ['<result>'] }
  } };
  const before = JSON.stringify(host.inspection);
  renderNativeInspector(host);
  assert.match(element.innerHTML, /&lt;App&gt;\.csproj/);
  assert.match(content.innerHTML, /&lt;unsafe&gt;&amp;/);
  assert.match(content.innerHTML, /&lt;Project \/&gt;/);
  assert.equal((content.innerHTML.match(/<summary>Item\d+<\/summary>/g) ?? []).length, 500);
  assert.match(content.innerHTML, /Showing 500 items/);
  filter.value = 'iTeM500';
  filter.oninput();
  assert.equal((content.innerHTML.match(/<summary>Item\d+<\/summary>/g) ?? []).length, 1);
  assert.match(content.innerHTML, /Item500/);
  assert.equal(JSON.stringify(host.inspection), before);
  host.inspection = { project: 'App.slnx', action: 'solution-structure', result: { Properties: { Name: 'App' } } };
  filter.value = 'absent';
  renderNativeInspector(host);
  assert.match(element.innerHTML, /data-only solution structure/);
  assert.doesNotMatch(content.innerHTML, /<tr>/);
  host.inspection.result = {};
  renderNativeInspector(host);
  assert.equal(content.innerHTML, '<p>No values match.</p>');
  assert.deepEqual(calls, []);
});
