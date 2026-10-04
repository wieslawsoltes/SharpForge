import test from 'node:test';
import assert from 'node:assert/strict';
import { scrollConfiguration } from '../packages/winui-controls/src/layout/scroll-configuration.js';

test('empty template defaults preserve outer snap collections and controller references', () => {
  const owner = { properties: { VerticalScrollController: { $ref: 'controller' } },
    collections: { VerticalSnapPoints: [{ $ref: 'outer-point' }] } };
  const part = { id: 'part', properties: { VerticalScrollController: null }, collections: { VerticalSnapPoints: [] } };
  const result = scrollConfiguration(part, owner);
  assert.equal(result.id, 'part');
  assert.deepEqual(result.properties.VerticalScrollController, { $ref: 'controller' });
  assert.deepEqual(result.collections.VerticalSnapPoints, [{ $ref: 'outer-point' }]);
  assert.equal(part.properties.VerticalScrollController, null);
  assert.deepEqual(part.collections.VerticalSnapPoints, []);
});

test('an explicitly configured presenter owns its axis and snap definitions', () => {
  const owner = { properties: { HorizontalScrollController: { $ref: 'outer' } },
    collections: { HorizontalSnapPoints: [20] } };
  const part = { properties: { HorizontalScrollController: { $ref: 'inner' } }, collections: { HorizontalSnapPoints: [40] } };
  const result = scrollConfiguration(part, owner);
  assert.deepEqual(result.properties.HorizontalScrollController, { $ref: 'inner' });
  assert.deepEqual(result.collections.HorizontalSnapPoints, [40]);
  assert.equal(scrollConfiguration(part, null), part);
});
