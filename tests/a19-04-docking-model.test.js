import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DockLayout, createGroup, createSplit, panelIds, migrateLayout, restorePersistedLayout, dockGuideTargets, hitDockGuide, clampFloatingBounds
} from '../packages/docking/src/index.js';

const panels = [{ id: 'a', kind: 'document' }, { id: 'b', kind: 'document' }, { id: 'watch' }, { id: 'output' }, { id: 'solution' }];
function fixture() {
  return new DockLayout(panels, { version: 1, root: createSplit('main', 'horizontal', createGroup('tools', ['watch', 'output']),
    createGroup('documents', ['a', 'b'], 'document'), .25), floating: [],
  autoHide: { left: [], right: [], top: [], bottom: [] }, closed: ['solution'], activePanel: 'a' });
}

test('v1 migrates without changing panel identities and v2 roundtrips metadata', () => {
  const layout = fixture();
  assert.equal(layout.state.version, 2);
  layout.setTabState('a', { pinned: true });
  layout.autoHide('watch', 'left');
  layout.resizeFlyout('watch', 515);
  const restored = new DockLayout(panels, layout.serialize());
  assert.deepEqual(restored.snapshot(), layout.snapshot());
  assert.deepEqual(restored.state.tabState.a, { pinned: true, preview: false });
  assert.equal(restored.state.flyoutSizes.watch, 515);
});

test('unknown and duplicate persisted panels are dropped and reported without substitution', () => {
  const layout = fixture();
  const snapshot = layout.snapshot();
  snapshot.root.first.panels.push('removed-tool');
  snapshot.root.first.active = 'removed-tool';
  snapshot.closed.push('watch');
  const result = restorePersistedLayout(snapshot, layout.panels);
  assert(result.diagnostics.some(item => item.code === 'SFDOCK001' && item.panelId === 'removed-tool'));
  assert(result.diagnostics.some(item => item.code === 'SFDOCK002' && item.panelId === 'watch'));
  assert.deepEqual(result.state.root.first.panels, ['watch', 'output']);
  assert(!panelIds(result.state.root).includes('solution'));
  layout.validate(result.state);
});

test('corrupt layouts recover valid closed identities and reject future versions in strict restore', () => {
  const layout = fixture();
  const before = layout.serialize();
  assert.throws(() => layout.restore({ ...layout.snapshot(), version: 300 }));
  assert.equal(layout.serialize(), before);
  const diagnostics = layout.restorePersisted('{broken');
  assert.equal(diagnostics[0].code, 'SFDOCK003');
  assert.deepEqual(new Set(layout.state.closed), new Set(panels.map(item => item.id)));
  assert.throws(() => migrateLayout(' '.repeat(2_000_001)));
});

test('all four auto-hide edges pin back to the exact previous tab group and index', () => {
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const layout = fixture();
    layout.autoHide('watch', side);
    assert.deepEqual(layout.state.autoHide[side], ['watch']);
    layout.pin('watch');
    assert.equal(layout.locate('watch').group.id, 'tools');
    assert.deepEqual(layout.locate('watch').group.panels, ['watch', 'output']);
  }
});

test('Auto Hide All restores a removed tool group against its original document anchor', () => {
  const layout = fixture();
  layout.autoHideAll();
  assert.equal(layout.groups().flatMap(group => group.panels).filter(id => ['watch', 'output'].includes(id)).length, 0);
  layout.pin('watch');
  layout.pin('output');
  assert.equal(layout.locate('watch').group.id, 'tools');
  assert.deepEqual(layout.locate('watch').group.panels, ['watch', 'output']);
  assert.equal(layout.state.root.axis, 'horizontal');
  assert.equal(layout.state.root.first.id, 'tools');
});

test('a floating tab group docks as one undoable operation retaining both tabs', () => {
  const layout = fixture();
  layout.floatGroup('tools', { width: 500, height: 300 });
  const floatingState = layout.serialize();
  const floatId = layout.state.floating[0].id;
  layout.dockGroup(floatId, 'documents', 'left');
  assert.equal(layout.state.floating.length, 0);
  assert.deepEqual(layout.group('tools').panels, ['watch', 'output']);
  assert(layout.undo());
  assert.equal(layout.serialize(), floatingState);
  assert(layout.redo());
  assert.equal(layout.state.floating.length, 0);
});

test('nested floating splits retain topology on edge re-dock and flatten only on center', () => {
  const layout = fixture();
  layout.dock('output', 'tools', 'bottom');
  const subtree = layout.state.root.first;
  assert.equal(subtree.type, 'split');
  layout.floatGroup(subtree.id);
  layout.dockGroup(layout.state.floating[0].id, 'documents', 'right');
  assert.equal(layout.node(subtree.id).type, 'split');
  layout.floatGroup(subtree.id);
  layout.dockGroup(layout.state.floating[0].id, 'documents', 'center');
  assert.deepEqual(layout.group('documents').panels, ['a', 'b', 'watch', 'output']);
});

test('nested transaction failures and cancelled pointer transactions leave no partial history', () => {
  const layout = fixture();
  const before = layout.serialize();
  const history = layout.undoStack.length;
  assert.throws(() => layout.transaction('bad', () => { layout.autoHide('watch'); layout.float('output', { width: -1 }); }));
  assert.equal(layout.serialize(), before);
  assert.equal(layout.undoStack.length, history);
  const snapshot = layout.snapshot();
  layout.resize('main', .55, { history: false });
  layout.finishInteraction(snapshot, { cancel: true });
  assert.equal(layout.serialize(), before);
  assert.equal(layout.undoStack.length, history);
});

test('monitor shrink clamps geometry and corrupt floating coordinates never escape viewport', () => {
  assert.deepEqual(clampFloatingBounds({ x: 2200, y: 1800, width: 1200, height: 1000 }, { width: 800, height: 600 }),
    { x: 0, y: 560, width: 800, height: 600 });
  const layout = fixture();
  layout.float('output', { x: 3000, y: 2000 });
  const result = restorePersistedLayout(layout.snapshot(), layout.panels, { viewport: { width: 800, height: 600 } });
  assert.equal(result.state.floating[0].x, 160);
  assert.equal(result.state.floating[0].y, 560);
});

test('nine explicit guide targets hit their own centers and execute the specified topology', () => {
  const targets = dockGuideTargets({ left: 240, top: 100, width: 900, height: 700 }, { left: 0, top: 0, width: 1400, height: 1000 });
  assert.equal(targets.length, 9);
  assert.equal(new Set(targets.map(item => item.id)).size, 9);
  assert.equal(hitDockGuide(targets, 5, 5), null);
  for (const target of targets) {
    assert.equal(hitDockGuide(targets, target.left + 20, target.top + 20)?.id, target.id);
    const layout = fixture();
    if (target.scope === 'root') layout.dockRoot('solution', target.side);
    else layout.dock('solution', 'documents', target.side);
    layout.validate(layout.state);
    assert.equal(layout.locate('solution').kind, 'group');
    if (target.side === 'center') assert.equal(layout.locate('solution').group.id, 'documents');
    else assert.notEqual(layout.locate('solution').group.id, 'documents');
  }
});

test('pin and preview partition is deterministic and pin metadata survives tab moves', () => {
  const layout = fixture();
  layout.setTabState('b', { preview: true });
  layout.setTabState('a', { pinned: true });
  layout.dock('b', 'documents', 'center', 0);
  assert.deepEqual(layout.group('documents').panels, ['a', 'b']);
  assert.throws(() => layout.setTabState('a', { preview: true }));
  assert.throws(() => layout.setTabState('watch', { pinned: true }));
});

test('background app registration preserves every visible group and global activation in one transaction', () => {
  const layout = fixture();
  layout.activate('output');
  layout.activate('a');
  layout.register({ id: 'app:second', title: 'Second application', kind: 'document' });
  const previous = layout.snapshot();
  const notifications = [];
  layout.subscribe(event => notifications.push(event.type));
  layout.open('app:second', null, { activate: false });
  assert.equal(layout.state.activePanel, 'a');
  assert.equal(layout.group('documents').active, 'a');
  assert.equal(layout.group('tools').active, 'output');
  assert(layout.group('documents').panels.includes('app:second'));
  assert.deepEqual(notifications, ['openBackground']);
  assert.equal(layout.undo(), true);
  assert.deepEqual(layout.snapshot(), previous);
});

test('background reopening auto-hidden tools and existing floating tabs cannot steal activation', () => {
  const layout = fixture();
  layout.autoHide('watch', 'right');
  layout.float('b');
  layout.activate('a');
  layout.open('watch', null, { activate: false });
  assert.equal(layout.state.activePanel, 'a');
  assert.equal(layout.group('tools').active, 'output');
  assert.equal(layout.locate('watch').kind, 'group');
  const before = layout.serialize();
  const history = layout.undoStack.length;
  assert.equal(layout.open('b', null, { activate: false }), false);
  assert.equal(layout.serialize(), before);
  assert.equal(layout.undoStack.length, history);
});
