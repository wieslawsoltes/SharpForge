import test from 'node:test';
import assert from 'node:assert/strict';
import { managedFamilyContext } from './helpers/a16-managed-context.js';
import { applyControlFamilyInput } from '../packages/winui-controls/src/policy/family-input.js';
import { managedTextModel } from '../packages/winui-controls/src/text/adapters.js';
import { managedSelectionModel, managedTreeModel } from '../packages/winui-controls/src/items/adapters.js';
import { managedWindow } from '../packages/winui-controls/src/app/adapters.js';

const C = 'Microsoft.UI.Xaml.Controls.';

test('host text input updates the authoritative model once and preserves history through rewind', () => {
  const context = managedFamilyContext();
  const owner = context.allocate(C + 'TextBox', { Text: 'ab', SelectionStart: 2, SelectionLength: 0 });
  const payload = { Text: 'abc', SelectionStart: 3, SelectionLength: 0 };
  assert.equal(applyControlFamilyInput(context, owner, 'TextChanged', payload), true);
  assert.equal(context.read(owner, 'Text'), 'abc');
  const model = managedTextModel(context, owner);
  assert.equal(model.canUndo, true);
  assert.equal(context.events.length, 0);
  const snapshot = context.snapshot();
  applyControlFamilyInput(context, owner, 'TextChanged', { Text: 'future', SelectionStart: 6 });
  context.restore(snapshot);
  assert.equal(managedTextModel(context, owner).text, 'abc');
  model.undo();
  assert.equal(context.read(owner, 'Text'), 'ab');
});

test('composition updates do not write committed Text until composition commits', () => {
  const context = managedFamilyContext();
  const owner = context.allocate(C + 'TextBox', { Text: '' });
  applyControlFamilyInput(context, owner, 'TextCompositionStarted', {});
  applyControlFamilyInput(context, owner, 'TextCompositionChanged', { Text: 'に' });
  assert.equal(context.read(owner, 'Text'), '');
  applyControlFamilyInput(context, owner, 'TextCompositionEnded', { Text: '日本', FullText: true, SelectionStart: 2 });
  assert.equal(context.read(owner, 'Text'), '日本');
  assert.equal(managedTextModel(context, owner).composition, null);
});

test('private passwords reject the public channel and preserve the managed getter value privately', () => {
  const context = managedFamilyContext();
  const owner = context.allocate(C + 'PasswordBox', { Password: '' });
  assert.equal(applyControlFamilyInput(context, owner, 'PasswordChanged', { Password: 'secret' }), false);
  assert.equal(context.read(owner, 'Password'), '');
  assert.equal(applyControlFamilyInput(context, owner, 'PasswordChanged', 'secret', { privateInput: true }), true);
  assert.equal(context.read(owner, 'Password'), 'secret');
  assert.equal(context.events.length, 0);
});

test('selection input resolves exact duplicate occurrences and reports authoritative added/removed items', () => {
  const context = managedFamilyContext();
  const a = context.allocate('Sample.Item', { Name: 'same' });
  const b = context.allocate('Sample.Item', { Name: 'other' });
  const owner = context.allocate(C + 'ListView', { Items: [a, a, b], SelectionMode: 2, SelectedIndex: -1 });
  const payload = { SelectedIndex: 1, SelectedIndices: [1] };
  assert.equal(applyControlFamilyInput(context, owner, 'SelectionChanged', payload), true);
  assert.equal(context.read(owner, 'SelectedItem'), a);
  assert.deepEqual(managedSelectionModel(context, owner).selectedIndices, [1]);
  assert.deepEqual(payload.AddedItems, [a]);
  const next = { SelectedIndex: 2, SelectedIndices: [2] };
  applyControlFamilyInput(context, owner, 'SelectionChanged', next);
  assert.deepEqual(next.RemovedItems, [a]);
  assert.deepEqual(next.AddedItems, [b]);
  assert.equal(context.events.length, 0);
  assert.ok([...managedSelectionModel(context, owner).retainedValues()].includes(b));
});

test('range input clamps before a managed callback and tri-state input preserves indeterminate state', () => {
  const context = managedFamilyContext();
  const slider = context.allocate(C + 'Slider', { Minimum: 10, Maximum: 20, Value: 12 });
  const payload = { NewValue: 100 };
  applyControlFamilyInput(context, slider, 'ValueChanged', payload);
  assert.equal(context.read(slider, 'Value'), 20);
  assert.equal(payload.NewValue, 20);
  const toggle = context.allocate(C + 'CheckBox');
  applyControlFamilyInput(context, toggle, 'Indeterminate', {});
  assert.equal(context.read(toggle, 'IsChecked'), false);
  assert.equal(context.read(toggle, 'IsIndeterminate'), true);
  applyControlFamilyInput(context, toggle, 'Checked', {});
  assert.equal(context.read(toggle, 'IsIndeterminate'), false);
  assert.equal(context.events.length, 0);
});

test('tree input mutates existing managed node ownership and rejects foreign selected nodes', () => {
  const context = managedFamilyContext();
  const child = context.allocate(C + 'TreeViewNode', { Content: 'child', Children: [], IsExpanded: false });
  const root = context.allocate(C + 'TreeViewNode', { Content: 'root', Children: [child], IsExpanded: false });
  const owner = context.allocate(C + 'TreeView', { RootNodes: [root], SelectionMode: 2 });
  applyControlFamilyInput(context, owner, 'ExpansionChanged', { Node: root, IsExpanded: true });
  assert.equal(context.read(root, 'IsExpanded'), true);
  applyControlFamilyInput(context, owner, 'SelectionChanged', { SelectedNodes: [root, child] });
  assert.equal(managedTreeModel(context, owner).selected.size, 2);
  assert.deepEqual(context.items(context.read(owner, 'SelectedItems')), ['root', 'child']);
  const foreign = context.allocate(C + 'TreeViewNode');
  assert.throws(() => applyControlFamilyInput(context, owner, 'SelectionChanged', { SelectedNodes: [foreign] }), /unowned/);
  assert.equal(context.events.length, 0);
});

test('Window Closed Handled cancels before exactly-once finalization and AppWindow Destroying', async () => {
  const context = managedFamilyContext();
  const window = context.allocate('Microsoft.UI.Xaml.Window');
  const appWindow = context.allocate('Microsoft.UI.Windowing.AppWindow');
  context.write(window, 'AppWindow', appWindow);
  let prevent = true;
  let finalized = 0;
  context.windowClosed = owner => { assert.equal(owner, window); finalized++; };
  context.on('Closed', (_owner, args) => { args.Handled = prevent; });
  const model = managedWindow(context, window);
  model.activate();
  assert.equal(await model.close(), false);
  assert.equal(model.visible, true);
  assert.equal(finalized, 0);
  prevent = false;
  assert.equal(await model.close(), true);
  assert.equal(finalized, 1);
  assert.equal(context.events.filter(event => event.name === 'Destroying').length, 1);
  assert.equal(await model.close(), false);
  assert.equal(finalized, 1);
});
