import test from 'node:test';
import assert from 'node:assert/strict';
import { InputVisualStateTracker, validateControlStateChanges } from '../packages/winui-controls/src/input/visual-state.js';
import { FocusManager } from '../packages/winui-controls/src/input/focus-manager.js';

function fixture() {
  const order = [], batches = [], storage = new Map();
  const nodes = new Map([['root', { id: 'root', properties: {} }], ['button', { id: 'button', properties: {} }],
    ['border', { id: 'border', templateOwner: 'button', properties: {} }]]);
  const parents = new Map([['border', 'button'], ['button', 'root']]);
  const host = { nodes, root: { contains: () => false }, parentOf: id => parents.get(id),
    options: { onControlStateChanged(changes) { batches.push(validateControlStateChanges(changes)); order.push('feedback'); } },
    services: { visualStates: { apply: (node, states) => order.push([node.id, states]) } },
    context: { getState(node) { if (!storage.has(node.id)) storage.set(node.id, {}); return storage.get(node.id); } }, invalidate() {} };
  return { host, tracker: new InputVisualStateTracker(host), nodes, order, batches };
}

test('template input publishes real owner PointerOver/Pressed state once before applying VSM', () => {
  const { tracker, nodes, batches, order } = fixture();
  tracker.pointer('pointerover', 'border', { pointerId: 1, pointerType: 'mouse' });
  assert.equal(nodes.get('button').properties.IsPointerOver, true);
  assert.equal(order[0], 'feedback');
  assert.equal(batches[0].filter(change => change.id === 'button').length, 1);
  tracker.pointer('pointerdown', 'border', { pointerId: 1, button: 0, pointerType: 'mouse' });
  assert.equal(nodes.get('button').properties.IsPressed, true);
  assert(order.some(value => Array.isArray(value) && value[0] === 'button' && value[1].includes('Pressed')));
  tracker.pointer('pointerout', 'border', { pointerId: 1, pointerType: 'mouse', relatedTarget: null });
  assert.equal(nodes.get('button').properties.IsPressed, false);
  tracker.pointer('pointerover', 'border', { pointerId: 1, pointerType: 'mouse' });
  assert.equal(nodes.get('button').properties.IsPressed, true);
  tracker.pointer('lostpointercapture', 'button', { pointerId: 1, pointerType: 'mouse' });
  assert.equal(nodes.get('button').properties.IsPressed, false);
});

test('keyboard presses and disabled ancestors clear IsPressed, while multi-touch release preserves other presses', () => {
  const { tracker, nodes } = fixture();
  tracker.keyboard('keydown', 'button', { key: ' ', repeat: false });
  assert.equal(nodes.get('button').properties.IsPressed, true);
  nodes.get('root').properties.IsEnabled = false;
  tracker.propertyChanged('root', 'IsEnabled');
  assert.equal(nodes.get('button').properties.IsPressed, false);
  nodes.get('root').properties.IsEnabled = true;
  tracker.propertyChanged('root', 'IsEnabled');
  assert.equal(nodes.get('button').properties.IsPressed, false);
  for (const pointerId of [1, 2]) tracker.pointer('pointerdown', 'border', { pointerId, pointerType: 'touch', button: 0 });
  tracker.pointer('pointerup', 'border', { pointerId: 1, pointerType: 'touch' });
  assert.equal(nodes.get('button').properties.IsPressed, true);
  tracker.pointer('pointercancel', 'border', { pointerId: 2, pointerType: 'touch' });
  assert.equal(nodes.get('button').properties.IsPressed, false);
});

test('focus read-only state precedes GotFocus callbacks and updates on pointer-to-keyboard transitions', () => {
  const { tracker, nodes } = fixture(), seen = [];
  const manager = new FocusManager({ nodes, router: { raise(id, event, args) {
    if (event === 'GotFocus') seen.push(nodes.get(id).properties.FocusState);
    return args;
  } }, onChanged: (previous, next, state) => tracker.focus(previous, next, state) });
  manager.focus('button', 1);
  assert.deepEqual(seen, [1]);
  manager.focus('button', 2);
  assert.equal(nodes.get('button').properties.FocusState, 2);
  manager.focus(null);
  assert.equal(nodes.get('button').properties.FocusState, 0);
  tracker.dispose();
  assert.equal(tracker.hover.size, 0);
});

test('control state transport only accepts bounded boolean/focus output fields', () => {
  const value = [{ id: 'control', properties: { IsPointerOver: true, IsPressed: false, FocusState: 2 } }];
  assert.deepEqual(structuredClone(validateControlStateChanges(value)), value);
  assert.throws(() => validateControlStateChanges([{ id: 'x', properties: { Password: 'private' } }]), /field/);
  assert.throws(() => validateControlStateChanges([{ id: 'x', properties: { FocusState: 4 } }]), /value/);
  assert.throws(() => validateControlStateChanges([{ id: 'x', properties: { IsPressed: 1 } }]), /value/);
  assert.throws(() => validateControlStateChanges(new Array(257).fill(value[0])), /limit/);
});
