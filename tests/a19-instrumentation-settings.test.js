import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkbenchShell} from '../apps/studio/workbench/shell.js';
import {createCommandRegistry} from '../apps/studio/commands/registry.js';
import {createWorkbenchServices} from '../apps/studio/workbench/sessions.js';
import {SettingsStore, validateSettings} from '../apps/studio/workbench/settings-store.js';
import {performanceTracingEnabled, WorkbenchPerformance} from '../apps/studio/workbench/perf.js';
import {registerGeneralOptions} from '../apps/studio/workbench/options/general-pages.js';
import {sessionDomRoot, descendants} from './a19-session-dom-fixture.js';

function storage() {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
}

function shellFixture(context, {settings, performance} = {}) {
  const document = {body: {}, documentElement: {dataset: {}, style: {setProperty() {}}}};
  const commands = createCommandRegistry(), services = createWorkbenchServices();
  const shell = new WorkbenchShell({document, commands, services, storage: storage(), settings, performance,
    requestCompiler: async () => [], navigate: async () => {}, state: () => ({})});
  context.after(() => { shell.dispose(); commands.dispose(); services.dispose(); });
  return shell;
}

test('tracing defaults on, persists per workspace, and rejects non-boolean preferences', () => {
  const disk = storage();
  const first = new SettingsStore({storage: disk, workspaceId: 'first'});
  assert.equal(first.load().environment.performanceTracing, true);
  first.apply({environment: {performanceTracing: false}}, {scope: 'workspace'});
  assert.equal(new SettingsStore({storage: disk, workspaceId: 'first'}).load().environment.performanceTracing, false);
  assert.equal(new SettingsStore({storage: disk, workspaceId: 'second'}).load().environment.performanceTracing, true);
  for (const value of [null, 0, 'false', {}, []]) {
    assert.throws(() => validateSettings({environment: {performanceTracing: value}}), /type/);
    assert.throws(() => performanceTracingEnabled({}, {enabled: value}), /boolean/);
    assert.throws(() => new WorkbenchPerformance({enabled: value}), /boolean/);
  }
});

test('real shells resolve saved settings before their first mark and keep live changes instance-local', context => {
  const settings = new SettingsStore({storage: storage()});
  settings.load(); settings.apply({environment: {performanceTracing: false}});
  const disabled = shellFixture(context, {settings});
  const defaultShell = shellFixture(context);
  assert.equal(disabled.metrics.start('startup'), null);
  assert.equal(defaultShell.metrics.start('startup').name, 'startup');
  settings.apply({environment: {performanceTracing: true}});
  assert.equal(disabled.metrics.enabled, true);
  settings.apply({environment: {performanceTracing: false}});
  assert.equal(disabled.metrics.enabled, false);
  assert.equal(defaultShell.metrics.enabled, true);
});

test('explicit embedding booleans override saved and subsequent settings in both directions', context => {
  for (const enabled of [false, true]) {
    const settings = new SettingsStore({storage: storage()});
    settings.load(); settings.apply({environment: {performanceTracing: !enabled}});
    const shell = shellFixture(context, {settings, performance: {enabled}});
    assert.equal(shell.metrics.enabled, enabled);
    settings.apply({environment: {performanceTracing: enabled}});
    settings.apply({environment: {performanceTracing: !enabled}});
    assert.equal(shell.metrics.enabled, enabled);
  }
});

test('Environment General exposes a working tracing checkbox with the stored preference', () => {
  const host = sessionDomRoot(), document = host.ownerDocument;
  document.createTextNode = text => { const node = document.createElement('text'); node.textContent = text; return node; };
  const settings = new SettingsStore({storage: storage()}); settings.load();
  const pages = [];
  registerGeneralOptions({register: page => pages.push(page)});
  pages.find(page => page.id === 'Environment.general').render(host, {draft: settings.snapshot(),
    update: (category, key, value) => settings.apply({[category]: {[key]: value}})});
  const label = descendants(host, node => node.tagName === 'label').find(node =>
    node.children.some(child => child.textContent === 'Record workbench performance traces'));
  assert(label);
  const checkbox = label.children[0];
  assert.equal(checkbox.checked, true);
  checkbox.checked = false;
  checkbox.dispatchEvent(new Event('change'));
  assert.equal(settings.get('environment', 'performanceTracing'), false);
});

test('disabled instruments read no clock and retain no marks, including input observation', () => {
  let clocks = 0;
  const metrics = new WorkbenchPerformance({enabled: false, clock: () => ++clocks});
  const target = new EventTarget(), remove = metrics.observeInput(target);
  metrics.end(metrics.start('command'));
  metrics.record('document-switch', 10);
  target.dispatchEvent(new Event('keydown'));
  assert.equal(clocks, 0);
  assert.deepEqual(JSON.parse(metrics.export()).samples, []);
  metrics.enabled = true;
  target.dispatchEvent(new Event('keydown'));
  assert.equal(metrics.samples.length, 1);
  remove();
  target.dispatchEvent(new Event('keydown'));
  assert.equal(metrics.samples.length, 1);
});
