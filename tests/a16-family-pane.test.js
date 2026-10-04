import test from 'node:test';
import assert from 'node:assert/strict';
import { PaneState, navigationGeometry, navigationDisplayMode } from '../packages/winui-controls/src/navigation/pane.js';
import { navigationEntries } from '../packages/winui-controls/src/navigation/menu-model.js';
import { managedPane } from '../packages/winui-controls/src/navigation/pane-adapters.js';
import { applyControlFamilyInput } from '../packages/winui-controls/src/policy/family-input.js';
import { managedFamilyContext } from './helpers/a16-managed-context.js';

const area = { width: 900, height: 600 };

test('SplitView overlay, inline and compact modes reserve the exact content width on either side', () => {
  for (const right of [false, true]) for (const mode of [0, 1, 2, 3]) for (const open of [false, true]) {
    const geometry = navigationGeometry('SplitView', { DisplayMode: mode, PanePlacement: right ? 1 : 0,
      OpenPaneLength: 300, CompactPaneLength: 48, IsPaneOpen: open }, area);
    const reserved = mode === 0 ? 0 : mode === 1 ? open ? 300 : 0 : mode === 2 ? 48 : open ? 300 : 48;
    assert.equal(geometry.content.width, 900 - reserved);
    assert.equal(geometry.content.x, right ? 0 : reserved);
    assert.equal(geometry.pane.x, right ? 900 - geometry.pane.width : 0);
    assert.equal(geometry.overlay, open && (mode === 0 || mode === 2));
  }
});

test('NavigationView breakpoints, explicit modes and top chrome use native display-mode values', () => {
  assert.deepEqual([640, 641, 1007, 1008].map(width => navigationDisplayMode({}, width)), [0, 1, 1, 2]);
  assert.equal(navigationDisplayMode({ PaneDisplayMode: 'LeftMinimal' }, 2000), 0);
  assert.equal(navigationDisplayMode({ PaneDisplayMode: 'Left' }, 320), 2);
  const top = navigationGeometry('NavigationView', { PaneDisplayMode: 'Top' }, area);
  assert.deepEqual(top.pane, { x: 0, y: 0, width: 900, height: 48 });
  assert.equal(top.content.height, 552);
  assert.throws(() => navigationDisplayMode({ CompactModeThresholdWidth: 900, ExpandedModeThresholdWidth: 800 }, 850), /threshold/);
  assert.throws(() => navigationGeometry('SplitView', { DisplayMode: 9 }, area), /display mode/);
});

test('pane cancellation, reentrancy, adaptive state and rewind are explicit', () => {
  const model = new PaneState({ open: true });
  const cancel = model.on('PaneClosing', args => { args.Cancel = true; });
  assert.equal(model.setOpen(false), false);
  assert.equal(model.open, true);
  cancel();
  const snapshot = model.snapshot();
  model.adapt({}, 320);
  assert.equal(model.open, false);
  assert.equal(model.displayMode, 0);
  model.restore(snapshot);
  assert.equal(model.open, true);
  const events = [];
  model.on('PaneClosing', () => { assert.throws(() => model.setOpen(false), /Reentrant/); events.push('closing'); });
  model.on('PaneClosed', () => events.push('closed'));
  assert.equal(model.setOpen(false), true);
  assert.deepEqual(events, ['closing', 'closed']);
});

test('hierarchical menu paths distinguish duplicate references and reject expanded cycles', () => {
  const child = { id: 'child', type: 'Microsoft.UI.Xaml.Controls.NavigationViewItem', properties: { Content: 'Child' }, collections: {} };
  const parent = { id: 'parent', type: child.type, properties: { Content: 'Parent', IsExpanded: true },
    collections: { MenuItems: [{ $ref: 'child' }, { $ref: 'child' }] } };
  const owner = { id: 'owner', type: 'Microsoft.UI.Xaml.Controls.NavigationView', properties: { IsSettingsVisible: true },
    collections: { MenuItems: [{ $ref: 'parent' }] } };
  const context = { nodes: new Map([['parent', parent], ['child', child]]) };
  assert.deepEqual(navigationEntries(context, owner).map(value => value.key), ['menu:0', 'menu:0.0', 'menu:0.1', 'settings']);
  parent.collections.MenuItems.push({ $ref: 'parent' });
  assert.throws(() => navigationEntries(context, owner), /cycle/);
});

test('host pane input updates managed state without dispatching duplicate events', () => {
  const context = managedFamilyContext();
  const receiver = context.allocate('Microsoft.UI.Xaml.Controls.NavigationView', { IsPaneOpen: false });
  const model = managedPane(context, receiver);
  assert.equal(applyControlFamilyInput(context, receiver, 'PaneOpened', { IsPaneOpen: true }), true);
  assert.equal(model.open, true);
  assert.equal(context.read(receiver, 'IsPaneOpen'), true);
  assert.equal(context.events.length, 0);
});
