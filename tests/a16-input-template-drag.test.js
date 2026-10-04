import test from 'node:test';
import assert from 'node:assert/strict';
import { DragDropManager } from '../packages/winui-controls/src/input/drag-drop.js';

test('drag source resolves a templated descendant to the enabled draggable owner', () => {
  const nodes = new Map([['owner', { properties: { CanDrag: true } }], ['border', { properties: {} }]]);
  const parents = new Map([['border', 'owner']]);
  const manager = new DragDropManager({ resolve: id => nodes.get(id), parentOf: id => parents.get(id) });
  assert.equal(manager.dragSource('border'), 'owner');
  nodes.get('border').properties.IsEnabled = false;
  assert.equal(manager.dragSource('border'), null);
  nodes.get('border').properties.IsEnabled = true;
  nodes.get('owner').properties.CanDrag = false;
  assert.equal(manager.dragSource('border'), null);
  manager.dispose();
});
