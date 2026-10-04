import test from 'node:test';
import assert from 'node:assert/strict';
import { DockLayout } from '../packages/docking/src/index.js';
import { DocumentTabs } from '../apps/studio/workbench/tabs/index.js';
import { documentTabMenu } from '../apps/studio/workbench/tabs/menu.js';
import { TestDocuments } from './support/a19-documents.js';

function fixture(confirmClose = async () => 'cancel', count = 5) {
  const uris = Array.from({ length: count }, (_, index) => `file${index}.cs`);
  const documents = new TestDocuments(uris);
  const layout = new DockLayout();
  const tabs = new DocumentTabs({ layout, documents, confirmClose });
  return { uris, documents, layout, tabs };
}

test('five concurrent preview navigations leave one preview; edit promotes and retains it', async () => {
  const { tabs, documents, uris, layout } = fixture();
  await Promise.all(uris.map(uri => tabs.open(uri, { preview: true })));
  assert.deepEqual(tabs.list(), ['source:file4.cs']);
  documents.edit('file4.cs');
  assert.equal(layout.state.tabState['source:file4.cs'].preview, false);
  await tabs.open('file0.cs', { preview: true });
  assert.deepEqual(tabs.list(), ['source:file4.cs', 'source:file0.cs']);
  tabs.dispose();
});

test('document edits redraw tab chrome only when dirty or preview metadata changes across shared views', async () => {
  const { tabs, documents, layout } = fixture();
  const primary = await tabs.open('file0.cs', { preview: true });
  const second = await tabs.open('file0.cs', { viewId: 'another', preview: false });
  const events = [];
  const off = layout.subscribe(event => events.push(event.type));
  documents.edit('file0.cs', 'first edit');
  assert.deepEqual(events, ['documentState']);
  assert.equal(layout.require(primary).dirty, true);
  assert.equal(layout.require(second).dirty, true);
  assert.equal(layout.state.tabState[primary].preview, false);
  events.length = 0;
  for (let index = 0; index < 100; index++) documents.edit('file0.cs', `edit ${index}`);
  documents.notify('dirty', 'file0.cs');
  documents.edit('file1.cs', 'closed document');
  assert.deepEqual(events, [], 'buffer edits must not rerender the entire docking host');
  documents.save('file0.cs');
  assert.deepEqual(events, ['documentState']);
  assert.equal(layout.require(primary).dirty, false);
  assert.equal(layout.require(second).dirty, false);
  events.length = 0;
  documents.notify('saved', 'file0.cs');
  assert.deepEqual(events, []);
  off();
  tabs.dispose();
});

test('pinned tabs survive close others and pin state roundtrips', async () => {
  const { tabs, uris, layout } = fixture();
  for (const uri of uris) await tabs.open(uri);
  tabs.pin('source:file0.cs');
  await tabs.closeVariant('source:file3.cs', 'others');
  assert.deepEqual(tabs.list(), ['source:file0.cs', 'source:file3.cs']);
  const restored = new DockLayout([...layout.panels.values()], layout.serialize());
  assert.equal(restored.state.tabState['source:file0.cs'].pinned, true);
  tabs.dispose();
});

test('Cancel in a batch aborts the complete close without saving or closing any earlier tab', async () => {
  const { tabs, uris, documents } = fixture(async () => ({ 'file0.cs': 'save', 'file1.cs': 'cancel' }));
  for (const uri of uris) await tabs.open(uri);
  documents.edit('file0.cs');
  documents.edit('file1.cs');
  assert.equal(await tabs.closeMany(tabs.list()), false);
  assert.equal(tabs.list().length, 5);
  assert.deepEqual(documents.saved, []);
  assert.deepEqual(documents.closed, []);
  tabs.dispose();
});

test('save failure, edited-during-prompt and explicit discard obey atomic close contracts', async () => {
  const { tabs, uris, documents } = fixture(async () => 'save');
  for (const uri of uris) await tabs.open(uri);
  documents.edit('file0.cs');
  documents.failSave = 'file0.cs';
  await assert.rejects(tabs.closeMany(tabs.list()), /Could not save/);
  assert.equal(tabs.list().length, 5);
  assert.deepEqual(documents.closed, []);
  tabs.confirmClose = async () => { documents.edit('file0.cs', 'new change'); return 'discard'; };
  await assert.rejects(tabs.closeMany(tabs.list()), /changed while awaiting/);
  assert.equal(tabs.list().length, 5);
  tabs.confirmClose = async () => 'discard';
  assert.equal(await tabs.closeMany(tabs.list()), true);
  assert.equal(tabs.list().length, 0);
  tabs.dispose();
});

test('closing a shared secondary view does not discard or prompt for the remaining buffer', async () => {
  let prompts = 0;
  const { tabs, documents, layout } = fixture(async () => { prompts++; return 'cancel'; });
  const primary = await tabs.open('file0.cs');
  const second = await tabs.newView(primary);
  assert.notEqual(second, primary);
  assert.equal(tabs.metadata(second).uri, 'file0.cs');
  documents.edit('file0.cs');
  assert.equal(await tabs.close(second), true);
  assert.equal(prompts, 0);
  assert.equal(documents.get('file0.cs').dirty, true);
  assert.equal(layout.locate(primary).kind, 'group');
  assert.equal(await tabs.close(primary), false);
  assert.equal(prompts, 1);
  tabs.dispose();
});

test('reopen restores the original caret and scroll; thirty tabs remain in the overflow model', async () => {
  const { tabs, uris, documents } = fixture(async () => 'save', 30);
  for (const uri of uris) await tabs.open(uri);
  assert.equal(tabs.list().length, 30);
  documents.restoreViewState('file14.cs', { start: 7, end: 11, scrollTop: 400, scrollLeft: 70 });
  await tabs.close('source:file14.cs');
  documents.restoreViewState('file14.cs', { start: 0, end: 0 });
  assert.equal(await tabs.reopenClosed(), 'source:file14.cs');
  assert.deepEqual(documents.getViewState('file14.cs'), { start: 7, end: 11, scrollTop: 400, scrollLeft: 70 });
  tabs.dispose();
});

test('context command enablement follows pinning, groups, side and host capabilities', async () => {
  const { tabs } = fixture();
  const id = await tabs.open('file0.cs');
  let items = documentTabMenu(tabs, id);
  assert.equal(items.find(item => item?.id === 'document.closeRight').enabled, false);
  assert.equal(items.find(item => item?.id === 'document.revealFolder').enabled, false);
  assert.equal(items.find(item => item?.id === 'document.moveNextGroup').enabled, false);
  const second = await tabs.open('file1.cs');
  tabs.split(second);
  items = documentTabMenu(tabs, id);
  assert.equal(items.find(item => item?.id === 'document.moveNextGroup').enabled, true);
  tabs.moveGroup(id, 1);
  assert.equal(tabs.layout.locate(id).group.id, tabs.layout.locate(second).group.id);
  tabs.dispose();
});

test('disposing during dirty confirmation cancels without discarding buffers', async () => {
  let resolve;
  const { tabs, documents } = fixture(() => new Promise(done => { resolve = done; }));
  const id = await tabs.open('file0.cs');
  documents.edit('file0.cs');
  const pending = tabs.close(id);
  tabs.dispose();
  resolve('discard');
  assert.equal(await pending, false);
  assert.deepEqual(documents.closed, []);
});
