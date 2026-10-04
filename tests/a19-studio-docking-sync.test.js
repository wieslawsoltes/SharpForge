import test from 'node:test';
import assert from 'node:assert/strict';
import { DockLayout } from '../packages/docking/src/index.js';
import { StudioDocking } from '../apps/studio/workbench/layout-workspace.js';
import { DocumentTabs } from '../apps/studio/workbench/tabs/index.js';
import { TestDocuments } from './support/a19-documents.js';

function fixture() {
  const documents = new TestDocuments(['a.cs', 'b.cs']);
  const layout = new DockLayout([{ id: 'app:one', title: 'Application', kind: 'document' },
    { id: 'output', title: 'Output', kind: 'tool' }]);
  const tabs = new DocumentTabs({ layout, documents });
  const docking = Object.assign(Object.create(StudioDocking.prototype), { layout, tabs, documents, content: new Map(),
    host: { contents: new Map(), popouts: new Map(), render() {} }, adapt() {} });
  return { docking, documents, layout, tabs, files: documents.list() };
}

test('initial document sync activates the selected primary view and opens other tabs in the background', () => {
  const { docking, files, layout, tabs } = fixture();
  docking.sync(files, ['a.cs', 'b.cs'], 'a.cs');
  assert.equal(layout.state.activePanel, 'source:a.cs');
  assert.notEqual(layout.locate('source:b.cs').kind, 'closed');
  tabs.dispose();
});

test('dirty document sync preserves its active secondary view and a different URI explicitly changes it', async () => {
  const { docking, documents, files, layout, tabs } = fixture();
  docking.sync(files, ['a.cs', 'b.cs'], 'a.cs');
  const second = await tabs.newView('source:a.cs');
  layout.activate(second);
  documents.edit('a.cs');
  docking.sync(files, ['a.cs', 'b.cs'], 'a.cs');
  assert.equal(layout.state.activePanel, second);
  docking.sync(files, ['a.cs', 'b.cs'], 'b.cs');
  assert.equal(layout.state.activePanel, 'source:b.cs');
  tabs.dispose();
});

test('background document sync preserves selected application or tool without changing group selection', () => {
  const { docking, files, layout, tabs } = fixture();
  docking.sync(files, ['a.cs'], 'a.cs');
  for (const panel of ['app:one', 'output']) {
    layout.open(panel);
    const group = layout.locate(panel).group;
    docking.sync(files, ['a.cs', 'b.cs'], 'a.cs');
    assert.equal(layout.state.activePanel, panel);
    assert.equal(group.active, panel);
  }
  tabs.dispose();
});

test('removing the active document returns to a surviving source and unregisters its secondary views', async () => {
  const { docking, files, layout, tabs } = fixture();
  docking.sync(files, ['a.cs', 'b.cs'], 'a.cs');
  const second = await tabs.newView('source:a.cs');
  docking.sync(files.filter(file => file.uri === 'b.cs'), ['b.cs'], 'b.cs');
  assert.equal(layout.state.activePanel, 'source:b.cs');
  assert.equal(layout.panels.has(second), false);
  assert.equal(tabs.metadata(second), null);
  tabs.dispose();
});

test('initial restore keeps the persisted secondary document selection', async () => {
  const original = fixture();
  original.docking.sync(original.files, ['a.cs', 'b.cs'], 'a.cs');
  const second = await original.tabs.newView('source:a.cs');
  const restored = fixture();
  restored.docking.pendingRestore = original.layout.serialize();
  restored.docking.factories = { restore: () => [] };
  restored.docking.host.element = { clientWidth: 1200, clientHeight: 800 };
  restored.docking.onError = error => { throw error; };
  restored.docking.sync(restored.files, ['a.cs', 'b.cs'], 'a.cs');
  assert.equal(restored.layout.state.activePanel, second);
  assert.deepEqual(restored.tabs.metadata(second), original.tabs.metadata(second));
  original.tabs.dispose();
  restored.tabs.dispose();
});
