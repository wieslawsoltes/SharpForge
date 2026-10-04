import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {toolDefinitions} from '../apps/studio/tools/definitions.js';
import {defaultDockLayout, applyBuildDockLayout} from '../apps/studio/dock-layouts.js';
import {renderNativeTool} from '../apps/studio/native-build/tool-renderer.js';
import {contributeMsbuildAutomation} from '../apps/studio/tools/msbuild-automation.js';
import {nativeToolsFixture} from './support/a23-native-tools.js';

test('Test Explorer has a unique dockable tool registration and build layout placement', () => {
  assert.equal(toolDefinitions.filter(tool => tool.id === 'tests').length, 1);
  const layout = defaultDockLayout();
  const documents = {type: 'group', id: 'documents', kind: 'document', panels: []};
  applyBuildDockLayout(layout, documents, []);
  assert.equal(layout.closed.includes('tests'), false);
  const groups = [];
  const visit = node => { if (node.type === 'group') groups.push(node); else { visit(node.first); visit(node.second); } };
  visit(layout.root);
  assert.ok(groups.find(group => group.id === 'tools-bottom').panels.includes('tests'));
  let rendered;
  assert.equal(renderNativeTool('tests', {}, {state: {}, nativeBuild: {render: panel => { rendered = panel; }}}), true);
  assert.equal(rendered, 'tests');
  assert.equal(renderNativeTool('unrelated', {}, {state: {}}), false);
});

test('native automation preserves established methods and exposes controller context/profile/test operations', async () => {
  const {tools, client} = nativeToolsFixture();
  let native;
  contributeMsbuildAutomation({contributeAutomation(name, contribution) { native = contribution.native; return () => {}; }}, {nativeBuild: tools});
  assert.deepEqual(['connect', 'attach', 'run', 'cancel', 'open', 'save', 'configure', 'getState'].filter(name => typeof native[name] !== 'function'), []);
  await native.connect(client);
  await native.profiles.refresh();
  native.profiles.selectLaunch('Local');
  assert.equal(native.profiles.getState().launchProfile, 'Local');
  native.configure({trusted: true});
  await native.contexts.load();
  assert.equal(native.contexts.getState().contexts.length, 2);
  assert.equal(typeof native.testing.cancel, 'function');
  await tools.dispose();
});

test('legacy MSBuild facade shrinks and the original source selectors remain in extracted views', async () => {
  const facade = await readFile(new URL('../apps/studio/msbuild-tools.js', import.meta.url), 'utf8');
  assert.ok(facade.length < 100);
  const views = (await Promise.all(['build-view', 'source-view', 'inspector-view'].map(name =>
    readFile(new URL('../apps/studio/native-build/' + name + '.js', import.meta.url), 'utf8')))).join('\n');
  for (const selector of ['data-native-setting', 'data-native-action', 'native-xml-editor', 'native-inspection-filter',
    'data-native-diagnostic', 'data-native-inspect', 'data-native-solution-inspect']) assert.ok(views.includes(selector), selector);
});
