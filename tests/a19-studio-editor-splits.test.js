import test from 'node:test';
import assert from 'node:assert/strict';
import { DockLayout, panelIds } from '@sharpforge/docking';
import { EditorModel } from '@sharpforge/editor';
import { DocumentService } from '../apps/studio/workbench/documents.js';
import { DocumentTabs } from '../apps/studio/workbench/tabs/index.js';
import { createStudioEditorHost } from '../apps/studio/workbench/studio-editor-host.js';

async function fixture({ openPath, keepEmptyDocuments = true } = {}) {
  const documents = new DocumentService({
    records: ['a.cs', 'b.cs', 'c.cs'].map(uri => ({ uri, text: `class ${uri[0].toUpperCase()} {}`, version: 1 })),
    createModel: record => new EditorModel(record.text, { uri: record.uri, version: record.version })
  });
  const layout = new DockLayout([], null, { keepEmptyDocuments });
  const tabs = new DocumentTabs({ documents, layout });
  const original = await tabs.open('a.cs');
  const opened = [];
  const docking = { tabs, layout };
  const context = { documents, docking, commands: { describe() {} },
    openPath: async uri => {
      opened.push(uri);
      if (openPath) return openPath({ uri, documents, tabs, layout });
      return tabs.open(uri);
    } };
  return { documents, layout, tabs, original, opened, host: createStudioEditorHost(context),
    dispose() { tabs.dispose(); documents.dispose(); } };
}

function assertSplit(layout, original, next, axis) {
  assert.equal(layout.state.root.type, 'split');
  assert.equal(layout.state.root.axis, axis);
  assert.deepEqual(panelIds(layout.state.root.first), [original]);
  assert.deepEqual(panelIds(layout.state.root.second), [next]);
  assert.equal(layout.groups().length, 2);
  assert(layout.groups().every(group => group.panels.length === 1));
}

test('horizontal host split creates one bottom group beside the original, with no intermediate vertical or empty group', async () => {
  const current = await fixture();
  const model = current.documents.models.get('a.cs');
  model.applyEdits([{ start: 7, end: 7, text: 'X' }]);
  const state = { start: 8, end: 8, scrollTop: 120, scrollLeft: 15 };
  current.documents.restoreViewState('a.cs', state);
  const events = [];
  current.layout.subscribe(event => events.push(event.type));
  const next = await current.host('splitHorizontal');
  assertSplit(current.layout, current.original, next, 'vertical');
  assert.equal(events.filter(type => type === 'dock').length, 1);
  assert.equal(current.documents.models.get('a.cs'), model);
  assert.deepEqual(current.documents.getViewState('a.cs', current.tabs.metadata(next).viewId), state);
  assert.equal(current.documents.get('a.cs').dirty, true);
  model.undo();
  assert.equal(current.documents.get('a.cs').text, 'class A {}');
  assert.equal(current.documents.get('a.cs').dirty, false);
  current.dispose();
});

test('vertical host split and default New Window retain one right-hand shared view', async () => {
  for (const invoke of [current => current.host('splitVertical'), current => current.tabs.newView(current.original)]) {
    const current = await fixture();
    const next = await invoke(current);
    assertSplit(current.layout, current.original, next, 'horizontal');
    assert.deepEqual(current.tabs.metadata(next).uri, 'a.cs');
    assert.equal(current.documents.models.size, 3);
    current.dispose();
  }
});

test('new views anchor to the requested source group instead of the first document group', async () => {
  const current = await fixture();
  const other = await current.tabs.open('b.cs');
  current.tabs.split(other, 'vertical');
  const first = current.layout.state.root.first.id;
  const originalGroup = current.layout.locate(other).group.id;
  current.tabs.activate(current.original);
  const next = await current.tabs.newView(other, { axis: 'horizontal' });
  assert.equal(current.layout.state.root.first.id, first);
  assert.equal(current.layout.state.root.second.type, 'split');
  assert.equal(current.layout.state.root.second.axis, 'vertical');
  assert.equal(current.layout.state.root.second.first.id, originalGroup);
  assert.deepEqual(panelIds(current.layout.state.root.second.first), [other]);
  assert.deepEqual(panelIds(current.layout.state.root.second.second), [next]);
  assert.equal(current.layout.groups().length, 3);
  current.dispose();
});

test('Vim split filename opens that workspace source and moves its exact panel beside the original once', async () => {
  const current = await fixture();
  const model = current.documents.models.get('b.cs');
  const next = await current.host('splitHorizontal', { uri: 'a.cs', path: './folder/../b.cs' });
  assert.equal(next, 'source:b.cs');
  assert.deepEqual(current.opened, ['b.cs']);
  assertSplit(current.layout, current.original, next, 'vertical');
  assert.equal(current.tabs.metadata(next).uri, 'b.cs');
  assert.equal(current.documents.models.get('b.cs'), model);
  assert.equal(current.tabs.list().length, 2, 'opening another source must not create an extra duplicate view');
  current.dispose();
});

test('a split path naming the current source clones its view and does not perform an unnecessary open', async () => {
  const current = await fixture();
  const next = await current.host('splitVertical', { uri: 'a.cs', path: './a.cs' });
  assert.notEqual(next, current.original);
  assertSplit(current.layout, current.original, next, 'horizontal');
  assert.deepEqual(current.opened, []);
  current.dispose();
});

test('invalid or non-workspace split paths fail before any open, group change or new view', async () => {
  const current = await fixture();
  const before = current.layout.serialize();
  for (const path of ['missing.cs', '../outside.cs', '/outside.cs', 'https://example.invalid/a.cs', 1]) {
    await assert.rejects(current.host('splitVertical', { uri: 'a.cs', path }));
    assert.equal(current.layout.serialize(), before);
  }
  assert.deepEqual(current.opened, []);
  assert.equal(current.tabs.views.size, 1);
  current.dispose();
});

test('a cancelled or failing workspace opener creates no split', async () => {
  for (const openPath of [async () => false, async () => { throw new Error('Permission unavailable'); }]) {
    const current = await fixture({ openPath });
    const before = current.layout.serialize();
    try { assert.equal(await current.host('splitHorizontal', { path: 'b.cs' }), false); }
    catch (error) { assert.match(error.message, /Permission unavailable/); }
    assert.equal(current.layout.serialize(), before);
    current.dispose();
  }
});

test('invalid split axes and missing original groups cannot allocate secondary views', async () => {
  const current = await fixture();
  const before = current.layout.serialize();
  await assert.rejects(current.tabs.newView(current.original, { axis: 'diagonal' }), /Invalid document group split/);
  assert.equal(current.layout.serialize(), before);
  assert.equal(current.tabs.views.size, 1);
  current.layout.close(current.original);
  await assert.rejects(current.tabs.newView(current.original), /No active document group/);
  assert.equal(current.tabs.views.size, 1);
  current.dispose();
});

test('removing the original group during an asynchronous source open reports the stale target without an extra view', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const current = await fixture({ keepEmptyDocuments: false, openPath: async ({ uri, tabs }) => {
    await wait;
    return tabs.open(uri);
  } });
  const pending = current.host('splitHorizontal', { path: 'b.cs' });
  current.layout.close(current.original);
  release();
  await assert.rejects(pending, /original document group/);
  assert.equal(current.tabs.views.size, 2, 'only the original and requested primary source were registered');
  assert.equal(current.layout.groups().length, 1);
  current.dispose();
});
