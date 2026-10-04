import test from 'node:test';
import assert from 'node:assert/strict';
import { DockLayout } from '../packages/docking/src/index.js';
import { DocumentTabs } from '../apps/studio/workbench/tabs/index.js';
import { WorkbenchNavigation } from '../apps/studio/workbench/navigation/index.js';
import { StudioNavigation } from '../apps/studio/workbench/studio-navigation.js';
import { TestDocuments } from './support/a19-documents.js';

async function fixture() {
  const layout = new DockLayout();
  const documents = new TestDocuments(['a.cs', 'b.cs']);
  documents.views = new Map();
  const tabs = new DocumentTabs({ layout, documents });
  const primary = await tabs.open('a.cs');
  const secondary = await tabs.open('a.cs', { viewId: 'split' });
  tabs.split(secondary);
  await tabs.open('b.cs');
  const focused = [];
  const menus = [];
  const host = { popouts: new Map(), focusPanel: id => focused.push(id), showMenu: (...args) => menus.push(args) };
  const navigation = new WorkbenchNavigation({ tabs, host });
  const docking = { layout, tabs, host, navigation };
  let editor;
  const updates = [];
  const adapter = new StudioNavigation({ docking, getEditor: () => editor, onChanged: value => updates.push(value) });
  function activate(id, start = 0, end = start) {
    const view = tabs.metadata(id);
    const byView = documents.views.get(view.uri) ?? new Map();
    editor = byView.get(view.viewId)?.editor ?? { uri: view.uri, input: {} };
    Object.assign(editor.input, { selectionStart: start, selectionEnd: end, scrollTop: 40 + start, scrollLeft: 2 });
    byView.set(view.viewId, { editor });
    documents.views.set(view.uri, byView);
    documents.restoreViewState(view.uri, { start, end, scrollTop: 40 + start, scrollLeft: 2 }, view.viewId);
    layout.activate(id);
    return editor;
  }
  activate(primary, 5, 8);
  return { layout, documents, tabs, host, navigation, adapter, updates, primary, secondary, activate, focused, menus };
}

test('actual focused view wins while dock activation is ahead of Studio editor installation', async () => {
  const f = await fixture();
  const source = f.activate(f.secondary, 12, 17);
  f.host.popouts.set(f.secondary, { identity: 'popout:split', window: { focus() {} } });
  f.layout.activate('source:b.cs');
  source.input.scrollTop = 1600;
  assert.deepEqual(f.adapter.capture(), {
    uri: 'a.cs', viewId: 'split', start: 12, end: 17, scrollTop: 1600, scrollLeft: 2,
    groupId: f.layout.locate(f.secondary).group.id, windowId: 'popout:split'
  });
  f.adapter.dispose();
  f.tabs.dispose();
});

test('nested open callbacks add one departure and one actual jump, retaining view identity', async () => {
  const f = await fixture();
  const outer = f.adapter.beforeOpen({ uri: 'a.cs', offset: 20, view: { viewId: 'split' } });
  f.layout.activate(f.secondary);
  const nested = f.adapter.beforeOpen({ uri: 'a.cs', view: { viewId: 'split' } });
  f.activate(f.secondary, 20, 23);
  assert.equal(f.adapter.afterJump(nested), false);
  assert.equal(f.adapter.afterJump(outer), true);
  assert.deepEqual(f.navigation.history.entries.map(value => [value.viewId, value.start]), [['primary', 5], ['split', 20]]);
  assert.equal(f.adapter.canBack, true);
  assert.equal(f.updates.at(-1).canBack, true);
  assert.equal(f.adapter.afterJump(outer), false);
  f.adapter.dispose();
  f.tabs.dispose();
});

test('ordinary caret movement does not create a jump and a failed open does not add a destination', async () => {
  const f = await fixture();
  f.navigation.record(f.adapter.capture());
  const token = f.adapter.beforeOpen({ uri: 'a.cs' });
  f.activate(f.primary, 24);
  assert.equal(f.adapter.afterJump(token), false);
  assert.equal(f.navigation.history.entries.length, 1);
  const failed = f.adapter.beforeOpen({ uri: 'b.cs' });
  f.activate('source:b.cs', 30);
  assert.equal(f.adapter.afterJump(failed, { record: false }), false);
  assert.equal(f.navigation.history.entries.length, 1);
  assert.equal(f.navigation.history.current.start, 24);
  assert.throws(() => f.adapter.beforeOpen({ uri: 'a.cs', offset: -1 }), /Invalid navigation target/);
  f.adapter.dispose();
  f.tabs.dispose();
});

test('direct window navigation and toolbar navigation replay the same history without recording activation', async () => {
  const f = await fixture();
  f.navigation.record(f.adapter.capture());
  const token = f.adapter.beforeOpen({ uri: 'b.cs', offset: 60 });
  f.activate('source:b.cs', 60, 64);
  f.adapter.afterJump(token);
  f.tabs.onActivate = id => {
    const view = f.tabs.metadata(id);
    const activation = f.adapter.beforeOpen({ uri: view.uri, view });
    f.activate(id);
    f.adapter.afterJump(activation);
  };
  await f.navigation.back();
  assert.equal(f.navigation.history.entries.length, 2);
  assert.equal(f.navigation.history.index, 0);
  assert.equal(f.documents.getViewState('a.cs').start, 5);
  assert.equal(f.updates.at(-1).canForward, true);
  await f.adapter.forward();
  assert.equal(f.navigation.history.index, 1);
  assert.equal(f.documents.getViewState('b.cs').start, 60);
  assert.equal(f.navigation.history.entries.length, 2);
  f.adapter.dispose();
  f.tabs.dispose();
});

test('dropdown entries replay the shared history and clear invalidates in-progress tokens', async () => {
  const f = await fixture();
  f.navigation.record(f.adapter.capture());
  const token = f.adapter.beforeOpen({ uri: 'b.cs', offset: 44 });
  f.activate('source:b.cs', 44);
  f.adapter.afterJump(token);
  f.adapter.menu(11, 22);
  const [entries, x, y, options] = f.menus[0];
  assert.equal(x, 11);
  assert.equal(y, 22);
  assert.equal(options.label, 'Navigation history');
  await entries[1].execute();
  assert.equal(f.navigation.history.index, 0);
  const outstanding = f.adapter.beforeOpen({ uri: 'b.cs', offset: 72 });
  f.adapter.clear();
  assert.equal(f.adapter.afterJump(outstanding), false);
  assert.deepEqual(f.adapter.snapshot(), { entries: [], index: -1, canBack: false, canForward: false });
  f.adapter.dispose();
  const count = f.updates.length;
  f.navigation.record({ uri: 'a.cs', start: 1 });
  assert.equal(f.updates.length, count);
  assert.throws(() => f.adapter.beforeOpen({ uri: 'a.cs' }), /disposed/);
  f.tabs.dispose();
});
