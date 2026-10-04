import test from 'node:test';
import assert from 'node:assert/strict';
import { RoutedEventRouter, PointerCaptureManager, FocusManager, tabOrder, nextTabStop } from '../packages/winui-controls/src/input/index.js';
import { element, panel } from './helpers/a16-layout.js';

test('routed events use original source, correct tunnel/bubble order, and handled-events-too', () => {
  const calls = [];
  const router = new RoutedEventRouter({ parentOf: id => id === 'child' ? 'parent' : null });
  router.addHandler('child', 'Pressed', (sender, args) => { calls.push(sender); args.Handled = true; });
  router.addHandler('parent', 'Pressed', () => calls.push('unhandled-only'));
  router.addHandler('parent', 'Pressed', (sender, args) => {
    calls.push(sender);
    assert.equal(args.OriginalSource, 'child');
  }, { handledEventsToo: true });
  router.raise('child', 'Pressed');
  assert.deepEqual(calls, ['child', 'parent']);
  calls.length = 0;
  router.raise('child', 'Pressed', {}, 'tunnel');
  assert.deepEqual(calls, ['unhandled-only', 'parent', 'child']);
  router.dispose();
  assert.equal(router.raise('child', 'Pressed'), null);
});

test('capture is exclusive and releases once on transfer, unload and native capture loss', () => {
  const held = new Set();
  const element = { setPointerCapture: id => held.add(id), hasPointerCapture: id => held.has(id),
    releasePointerCapture: id => held.delete(id) };
  const lost = [];
  const manager = new PointerCaptureManager({ elementFor: () => element, onLost: (id, args) => lost.push([id, args.Reason]) });
  assert.equal(manager.capture('one', 4), true);
  assert.equal(manager.capture('two', 4), true);
  assert.equal(manager.owner(4), 'two');
  manager.lost(4);
  manager.lost(4);
  assert.deepEqual(lost, [['one', 'Transferred'], ['two', 'NativeCaptureLost']]);
  manager.capture('one', 5);
  manager.dispose();
  assert.equal(manager.captures.size, 0);
  assert.equal(held.size, 0);
});

test('routed subscription ordinals preserve ordinary and AddHandler interleaving after grouped snapshot restore', () => {
  const calls = [];
  const router = new RoutedEventRouter();
  const one = router.addHandler('node', 'Tapped', () => calls.push('ordinary 1'));
  const two = router.addHandler('node', 'Tapped', () => calls.push('AddHandler'));
  const three = router.addHandler('node', 'Tapped', () => calls.push('ordinary 2'));
  const orders = [one.order, two.order, three.order];
  one(); two(); three();
  router.addHandler('node', 'Tapped', () => calls.push('ordinary 1'), { order: orders[0] });
  router.addHandler('node', 'Tapped', () => calls.push('ordinary 2'), { order: orders[2] });
  router.addHandler('node', 'Tapped', () => calls.push('AddHandler'), { order: orders[1] });
  router.raise('node', 'Tapped');
  assert.deepEqual(calls, ['ordinary 1', 'AddHandler', 'ordinary 2']);
  const next = router.addHandler('node', 'Tapped', () => {});
  assert(next.order > orders[2]);
  assert.throws(() => router.addHandler('node', 'Tapped', () => {}, { order: Infinity }), /order/);
  router.dispose();
});

test('tab ordering honors Once and Cycle while canceled focus leaves current element intact', () => {
  const nodes = new Map([panel('root', 'Panel', ['first', 'scope', 'last']),
    panel('scope', 'Panel', ['inside1', 'inside2'], { TabFocusNavigation: 2 }),
    element('first', { TabIndex: 0 }), element('inside1', { TabIndex: 0 }),
    element('inside2', { TabIndex: 0 }), element('last', { TabIndex: 0 })].map(node => [node.id, node]));
  const children = id => (nodes.get(id).collections?.Children ?? []).map(value => value.$ref);
  const parents = new Map([['first', 'root'], ['scope', 'root'], ['last', 'root'], ['inside1', 'scope'], ['inside2', 'scope']]);
  const order = tabOrder(nodes, ['root'], children, { current: 'inside2' });
  assert.deepEqual(order, ['first', 'inside2', 'last']);
  assert.equal(nextTabStop(order, 'last', false, true), 'first');
  const router = new RoutedEventRouter({ parentOf: id => parents.get(id) });
  const focus = new FocusManager({ router, nodes, roots: () => ['root'], childrenOf: children, parentOf: id => parents.get(id) });
  assert.equal(focus.focus('first'), true);
  router.addHandler('last', 'GettingFocus', (sender, args) => { args.Cancel = true; });
  assert.equal(focus.focus('last'), false);
  assert.equal(focus.focusedElement, 'first');
  focus.dispose();
  assert.equal(focus.focusedElement, null);
});
