import test from 'node:test';
import assert from 'node:assert/strict';
import {UIObjectTree, RoutedEventRegistry} from '@sharpforge/winui-properties';

test('object tree: template visual parenting stays separate from logical content parenting', () => {
  const parents = [];
  const tree = new UIObjectTree({onLogicalParentChanged: (child, parent) => parents.push([child, parent])});
  for (const id of ['page', 'button', 'part', 'content']) tree.register(id, {root: id === 'page'});
  tree.setVisualParent('button', 'page');
  tree.setLogicalParent('button', 'page');
  tree.setVisualParent('part', 'button');
  tree.setVisualParent('content', 'part');
  tree.setLogicalParent('content', 'button');
  assert.equal(tree.getVisualParent('content'), 'part');
  assert.equal(tree.getLogicalParent('content'), 'button');
  assert.deepEqual(tree.getVisualChildren('button'), ['part']);
  assert.deepEqual(parents, [['button', 'page'], ['content', 'button']]);
  assert.throws(() => tree.setVisualParent('page', 'content'), {code: 'SFTREE003'});
  assert.equal(tree.getVisualParent('page'), null);
  tree.dispose();
  assert.equal(tree.nodes.size, 0);
});

test('object tree: lifecycle is parent-first Loading/Loaded and reverse Unloaded with actual size changes only', () => {
  const events = [];
  const tree = new UIObjectTree({onEvent: (id, name, args) => events.push({id, name, args})});
  tree.register('root', {root: true});
  tree.register('child');
  tree.setVisualParent('child', 'root');
  tree.setConnected('root', true);
  assert.deepEqual(events.map(value => value.name + ':' + value.id), ['Loading:root', 'Loading:child', 'Loaded:root', 'Loaded:child']);
  tree.setConnected('root', true);
  assert.equal(events.length, 4);
  tree.setBounds('child', {x: 10, y: 5, width: 50, height: 20});
  tree.setBounds('child', {x: 20, y: 5, width: 50, height: 20});
  assert.deepEqual(events.at(-1).args, {PreviousSize: {width: 0, height: 0}, NewSize: {width: 50, height: 20}});
  assert.equal(events.filter(value => value.name === 'SizeChanged').length, 1);
  tree.setConnected('root', false);
  assert.deepEqual(events.slice(-2).map(value => value.name + ':' + value.id), ['Unloaded:child', 'Unloaded:root']);
});

test('object tree: host-coordinate results use inverse visual order and snapshots emit no callbacks', () => {
  let events = 0;
  const tree = new UIObjectTree({onEvent: () => events++});
  for (const id of ['root', 'back', 'backPart', 'front']) {
    tree.register(id, {root: id === 'root'});
    tree.setBounds(id, {x: 0, y: 0, width: 100, height: 100});
  }
  tree.setVisualParent('back', 'root');
  tree.setVisualParent('backPart', 'back');
  tree.setVisualParent('front', 'root');
  assert.deepEqual(tree.findElementsInHostCoordinates({x: 5, y: 5}), ['front', 'backPart', 'back', 'root']);
  assert.deepEqual(tree.findElementsInHostCoordinates({x: 200, y: 200}, 'root'), []);
  tree.require('front').hitTestVisible = false;
  assert.equal(tree.findElementsInHostCoordinates({x: 5, y: 5})[0], 'backPart');
  assert.equal(tree.findElementsInHostCoordinates({x: 5, y: 5}, null, {includeAllElements: true})[0], 'front');
  const before = tree.snapshot();
  tree.remove('back');
  const eventCount = events;
  tree.restore(before);
  assert.equal(events, eventCount);
  assert.equal(tree.getVisualParent('backPart'), 'back');
  assert.throws(() => tree.setBounds('root', {x: 0, y: 0, width: -1, height: 10}), {code: 'SFTREE004'});
});

test('routed identities: registration is session-local, bounded, and cannot be forged', () => {
  const registry = new RoutedEventRegistry({maxEvents: 1});
  const event = registry.register({name: 'Tapped', ownerType: 'Element'});
  assert.equal(registry.resolve(event), event);
  assert.throws(() => registry.resolve({...event}), TypeError);
  assert.throws(() => registry.register({name: 'Tapped', ownerType: 'Element'}), TypeError);
  assert.throws(() => registry.register({name: 'Other', ownerType: 'Element'}), RangeError);
  assert.throws(() => new RoutedEventRegistry().resolve(event), TypeError);
});
