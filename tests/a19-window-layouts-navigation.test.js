import test from 'node:test';
import assert from 'node:assert/strict';
import { DockLayout, createGroup, createSplit, panelIds } from '../packages/docking/src/index.js';
import { WindowLayouts } from '../apps/studio/workbench/layout-management/index.js';
import { WorkbenchNavigationHistory } from '../apps/studio/workbench/navigation-history.js';
import { WorkbenchNavigation } from '../apps/studio/workbench/navigation/index.js';
import { DocumentTabs } from '../apps/studio/workbench/tabs/index.js';
import { ToolWindowFactories } from '../apps/studio/workbench/window-factories.js';
import { windowCommands } from '../apps/studio/workbench/window-management/window-commands.js';
import { TestDocuments } from './support/a19-documents.js';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function layout() {
  return new DockLayout([{ id: 'source:a.cs', kind: 'document' }, { id: 'source:b.cs', kind: 'document' }, { id: 'watch' }, { id: 'output' }], {
    version: 1, root: createSplit('main', 'vertical', createGroup('documents', ['source:a.cs'], 'document'),
      createGroup('tools', ['watch', 'output']), .7), floating: [], autoHide: { left: [], right: [], top: [], bottom: [] },
    closed: ['source:b.cs'], activePanel: 'source:a.cs'
  });
}

test('saved tool layout applies across document sets without closing or reopening documents', () => {
  const model = layout();
  const layouts = new WindowLayouts({ layout: model, storage: storage(), key: 'layouts' });
  layouts.save('Coding');
  model.close('source:a.cs');
  model.open('source:b.cs');
  model.setTabState('source:b.cs', { pinned: true });
  model.autoHide('watch', 'left');
  model.float('output');
  layouts.apply('Coding');
  assert(model.state.closed.includes('source:a.cs'));
  assert(panelIds(model.state.root).includes('source:b.cs'));
  assert.equal(model.state.tabState['source:b.cs'].pinned, true);
  assert.equal(model.locate('watch').group.id, 'tools');
  assert.equal(model.state.floating.length, 0);
});

test('saved layouts support legacy payloads, stable slots, rename, delete and rejected persistence', () => {
  const backend = storage();
  const model = layout();
  backend.setItem('layouts', JSON.stringify({ Old: model.snapshot() }));
  const layouts = new WindowLayouts({ layout: model, storage: backend, key: 'layouts' });
  assert.deepEqual(layouts.names(), ['Old']);
  layouts.rename('Old', 'Coding');
  assert.equal(layouts.applySlot(9), false);
  assert.throws(() => layouts.applySlot(0));
  assert.throws(() => layouts.save(''));
  layouts.save('Debug');
  assert.throws(() => layouts.rename('Debug', 'Coding'));
  assert.equal(layouts.remove('Coding'), true);
  assert.deepEqual(new WindowLayouts({ layout: model, storage: backend, key: 'layouts' }).names(), ['Debug']);
  layouts.storage = { setItem: () => { throw new Error('Quota'); } };
  assert.throws(() => layouts.save('Unsaved'), /Quota/);
  assert.deepEqual(layouts.names(), ['Debug']);
});

test('reset requires an explicit positive choice', async () => {
  let resets = 0;
  const layouts = new WindowLayouts({ layout: layout(), reset: () => { resets++; }, confirmReset: async () => false });
  assert.equal(await layouts.reset(), false);
  assert.equal(resets, 0);
  layouts.confirmReset = async () => true;
  await layouts.reset();
  assert.equal(resets, 1);
});

test('navigation retains group, view and popout identities and rejects malformed locations', () => {
  const history = new WorkbenchNavigationHistory({ limit: 3 });
  history.push({ uri: 'a.cs', start: 4, end: 8, groupId: 'group-a', viewId: 'view-1', windowId: 'popout:source:a.cs' });
  history.push({ uri: 'b.cs', start: 10, groupId: 'group-b' });
  assert.deepEqual(history.back(), { uri: 'a.cs', start: 4, end: 8, groupId: 'group-a', viewId: 'view-1',
    windowId: 'popout:source:a.cs', scrollTop: 0, scrollLeft: 0 });
  history.push({ uri: 'c.cs', start: 0 });
  assert.equal(history.canForward, false);
  assert.throws(() => history.push({ uri: '', start: 0 }));
  assert.throws(() => history.push({ uri: 'a', start: 8, end: 2 }));
  assert.throws(() => history.go(3));
  assert(Object.isFrozen(history.current));
});

test('navigation returns moved tab to its original existing document group', async () => {
  const model = new DockLayout();
  const documents = new TestDocuments(['a.cs', 'b.cs']);
  const tabs = new DocumentTabs({ layout: model, documents });
  const a = await tabs.open('a.cs');
  const original = model.locate(a).group.id;
  const b = await tabs.open('b.cs');
  tabs.split(b);
  const next = model.locate(b).group.id;
  model.dock(a, next);
  const focused = [];
  const host = { popouts: new Map(), focusPanel: id => focused.push(id) };
  const navigation = new WorkbenchNavigation({ tabs, host });
  await navigation.replay({ uri: 'a.cs', start: 12, end: 15, groupId: original, viewId: 'primary', windowId: 'main' });
  assert.equal(model.locate(a).group.id, original);
  assert.equal(documents.getViewState('a.cs').start, 12);
  assert.deepEqual(focused, [a]);
  tabs.dispose();
});

test('tool factories create independent instances and restore exact identities', () => {
  const model = new DockLayout();
  const contents = new Map();
  const factories = new ToolWindowFactories({ layout: model, content: contents });
  factories.register('watch', record => ({ append() {}, expressions: [], record }), { limit: 4, title: 'Watch' });
  const one = factories.create('watch', 1);
  const two = factories.create('watch', 2);
  assert.notEqual(contents.get(one), contents.get(two));
  contents.get(one).expressions.push('x');
  assert.deepEqual(contents.get(two).expressions, []);
  assert.throws(() => factories.create('watch', 5));
  const other = new DockLayout();
  const restored = new ToolWindowFactories({ layout: other, content: new Map() });
  restored.register('watch', () => ({ append() {} }), { limit: 4 });
  assert.deepEqual(restored.restore(model.snapshot().panelInstances), []);
  other.restore(model.snapshot());
  assert.equal(other.locate(two).kind, 'group');
  assert.equal(restored.restore({ missing: { kind: 'missing', instance: 1 } })[0].code, 'SFDOCK005');
});

test('Window command descriptors include layout slots and keyboard-only management', () => {
  const windows = { active: null, documentActive: () => false, tabs: { list: () => [], closed: [] },
    layouts: { entries: [] }, navigation: { history: { canBack: false, canForward: false } } };
  const commands = windowCommands(windows);
  assert.equal(commands.filter(item => item.id.startsWith('window.applyLayout')).length, 9);
  assert.equal(commands.find(item => item.id === 'window.fullscreen').shortcut, 'Shift+Alt+Enter');
  assert.equal(commands.find(item => item.id === 'window.newWindow').enabled(), false);
  assert.equal(commands.find(item => item.id === 'window.closeTool').enabled(), false);
  assert.equal(commands.find(item => item.id === 'window.navigator').shortcut, 'Ctrl+Tab');
});
