import test from 'node:test';
import assert from 'node:assert/strict';
import { DockLayout, createGroup } from '@sharpforge/docking';
import { StudioDocking, toolDefinitions } from '../apps/studio/docking-workspace.js';
import { migrateDesignerLayout } from '../apps/studio/designer-layout-migration.js';

const primary = 'source:View.cs';
const secondary = 'document-view:1:View.cs';
const other = 'source:Other.cs';
const dynamic = 'search-results:1';

function layoutFixture() {
  const layout = new DockLayout([...toolDefinitions,
    {id: primary, kind: 'document'}, {id: other, kind: 'document'}], {
    version: 1, root: createGroup('documents', [primary], 'document'), floating: [],
    autoHide: {left: [], right: [], top: [], bottom: []},
    closed: [...toolDefinitions.map(panel => panel.id), other], activePanel: primary
  });
  return layout;
}

function persistedLayout() {
  return {
    version: 2, root: createGroup('documents', ['designer', primary, secondary], 'document'), floating: [],
    autoHide: {left: [], right: [], top: [], bottom: []},
    closed: [...toolDefinitions.map(panel => panel.id).filter(id => id !== 'designer'), other, dynamic], activePanel: 'designer',
    returnLocations: {}, flyoutSizes: {},
    tabState: {[secondary]: {pinned: true, preview: false}, designer: {pinned: false, preview: true}},
    documentViews: {[primary]: {uri: 'View.cs', viewId: 'primary'}, [secondary]: {uri: 'View.cs', viewId: 'split'}},
    panelInstances: {[dynamic]: {kind: 'search', instance: '1'}}
  };
}

test('designer restore preserves v2 secondary views and dynamic factories before workbench identity repair', () => {
  const docking = Object.create(StudioDocking.prototype);
  const layout = layoutFixture(), errors = [], views = new Map();
  const serialized = JSON.stringify(persistedLayout());
  docking.layout = layout;
  docking.pendingRestore = serialized;
  docking.onError = error => errors.push(error);
  docking.adapt = () => {};
  docking.documents = {get: () => ({dirty: false})};
  docking.host = {contents: new Map(), element: {clientWidth: 1200, clientHeight: 800}, render() {}};
  docking.factories = {restore: instances => {
    assert.deepEqual(Object.keys(instances), [dynamic]);
    layout.register({id: dynamic, kind: 'tool'});
    return [];
  }};
  docking.tabs = {
    views,
    ensure: uri => views.set(`source:${uri}`, {uri, viewId: 'primary'}),
    metadata: id => views.get(id) ?? layout.state.documentViews?.[id]
      ?? (id?.startsWith('source:') ? {uri: id.slice(7), viewId: 'primary'} : null)
  };
  docking.sync([{uri: 'View.cs'}, {uri: 'Other.cs'}], ['View.cs', 'Other.cs'], 'View.cs');
  const restored = layout.snapshot();
  assert.equal(restored.version, 2);
  assert.equal(restored.activePanel, primary);
  assert.equal(layout.locate(secondary).kind, 'group');
  assert.deepEqual(docking.tabs.metadata(secondary), {uri: 'View.cs', viewId: 'split'});
  assert.deepEqual(restored.tabState[secondary], {pinned: true, preview: false});
  assert.equal(restored.tabState.designer, undefined);
  assert.deepEqual(restored.panelInstances, {[dynamic]: {kind: 'search', instance: '1'}});
  assert.equal(layout.panels.has(dynamic), true);
  assert.equal(docking.pendingRestore, null);
  assert.equal(docking.restoring, false);
  assert.deepEqual(errors, []);
  assert.equal(JSON.parse(serialized).activePanel, 'designer');
});

test('designer preset keeps active secondary views, pinned state, closed documents and registered dynamic tools', () => {
  const layout = layoutFixture();
  layout.register({id: secondary, kind: 'document'});
  layout.register({id: dynamic, kind: 'tool'});
  layout.open(secondary, 'documents');
  layout.setTabState(secondary, {pinned: true, preview: false});
  layout.state.documentViews = {[primary]: {uri: 'View.cs', viewId: 'primary'}, [secondary]: {uri: 'View.cs', viewId: 'split'}};
  layout.state.panelInstances = {[dynamic]: {kind: 'search', instance: '1'}};
  const before = layout.snapshot();
  let adapted = 0;
  const docking = {layout, mobile: true, adapt: () => adapted++};
  assert.equal(StudioDocking.prototype.reset.call(docking, 'designer'), true);
  const state = layout.snapshot();
  assert.equal(state.version, 2);
  assert.equal(state.activePanel, secondary);
  assert.deepEqual(layout.group('design-surface').panels, [secondary, primary]);
  assert.equal(layout.locate(other).kind, 'closed');
  assert.equal(layout.locate(dynamic).kind, 'closed');
  assert.deepEqual(state.documentViews, before.documentViews);
  assert.deepEqual(state.tabState, before.tabState);
  assert.deepEqual(state.panelInstances, before.panelInstances);
  assert.equal(docking.mobile, false);
  assert.equal(adapted, 1);
});

test('v2 designer migration preserves unregistered view metadata and rejects future formats', () => {
  const state = persistedLayout();
  const migrated = migrateDesignerLayout(state, {activeUri: 'View.cs'});
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.documentViews, state.documentViews);
  assert.deepEqual(migrated.panelInstances, state.panelInstances);
  assert.equal(migrated.tabState.designer, undefined);
  assert.throws(() => migrateDesignerLayout({...state, version: 3}), /version-1 or version-2/);
});
