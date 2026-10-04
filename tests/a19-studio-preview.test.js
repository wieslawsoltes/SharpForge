import test from 'node:test';
import assert from 'node:assert/strict';
import { DockLayout } from '../packages/docking/src/index.js';
import { DocumentTabs } from '../apps/studio/workbench/tabs/index.js';
import { WorkbenchNavigation } from '../apps/studio/workbench/navigation/index.js';
import { StudioNavigation } from '../apps/studio/workbench/studio-navigation.js';
import { createStudioLocationOpener } from '../apps/studio/workbench/studio-open-location.js';
import { TestDocuments } from './support/a19-documents.js';

function fixture(t) {
  const uris = Array.from({ length: 5 }, (_, index) => `Preview${index}.cs`);
  const documents = new TestDocuments(uris);
  const layout = new DockLayout();
  const tabs = new DocumentTabs({ layout, documents });
  const host = { popouts: new Map(), focusPanel() {} };
  const history = new WorkbenchNavigation({ tabs, host });
  const docking = { tabs, layout, navigation: history };
  const navigation = new StudioNavigation({ docking, getEditor: () => null });
  const openFile = (uri, start, end, view) => {
    const nested = navigation.beforeOpen({ uri, offset: start, view });
    documents.restoreViewState(uri, { start: start ?? 0, end: end ?? start ?? 0 }, view.viewId);
    layout.activate(view.panelId);
    navigation.afterJump(nested);
  };
  t.after(() => { navigation.dispose(); tabs.dispose(); });
  return { uris, documents, tabs, layout, navigation, open: createStudioLocationOpener({ docking, navigation, openFile }) };
}

test('five actual Studio preview opens reuse one tab and retain ordered jump history', async t => {
  const fixtureValue = fixture(t);
  const { uris, open, tabs, layout, navigation } = fixtureValue;
  await Promise.all(uris.map((uri, index) => open({ uri, start: index * 10, preview: true })));
  assert.deepEqual(tabs.list(), ['source:Preview4.cs']);
  assert.equal(layout.state.tabState['source:Preview4.cs'].preview, true);
  assert.deepEqual(navigation.snapshot().entries.map(entry => [entry.uri, entry.start]),
    uris.map((uri, index) => [uri, index * 10]));
  await open({ uri: uris[4] });
  assert.equal(layout.state.tabState['source:Preview4.cs'].preview, false);
  await open({ uri: uris[0], preview: true });
  assert.equal(tabs.list().includes('source:Preview4.cs'), true);
});

test('failed preview destinations do not enter history or block the next valid navigation', async t => {
  const { uris, open, navigation } = fixture(t);
  await open({ uri: uris[0], start: 9, preview: true });
  await assert.rejects(open({ uri: uris[1], groupId: 'missing-group', preview: true }), /Unknown document group/);
  assert.deepEqual(navigation.snapshot().entries.map(entry => entry.uri), [uris[0]]);
  await open({ uri: uris[2], start: 12, preview: true });
  assert.deepEqual(navigation.snapshot().entries.map(entry => entry.uri), [uris[0], uris[2]]);
});
