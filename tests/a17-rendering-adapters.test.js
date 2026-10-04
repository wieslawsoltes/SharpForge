import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingModel, serializeRenderingValue} from '../packages/rendering/src/media/models.js';
const M = 'Microsoft.UI.Xaml.Media.', F = 'Windows.Foundation.';

test('CLR drawing structs serialize as flat typed values while scene objects retain their property descriptors', () => {
  for (const [type, data] of [[F + 'Point', {X: 3, Y: 4}], [F + 'Size', {Width: 8, Height: 9}],
    [F + 'Rect', {X: 1, Y: 2, Width: 8, Height: 9}],
    [M + 'Matrix', {M11: 1, M12: 0, M21: 0, M22: 1, OffsetX: 2, OffsetY: 3}]]) {
    assert.deepEqual(serializeRenderingValue(new DrawingModel(type, data)), {...data, valueType: type});
  }
  const point = new DrawingModel(F + 'Point', {X: 3, Y: 4});
  const geometry = serializeRenderingValue(new DrawingModel(M + 'LineSegment', {Point: point}));
  assert.equal(geometry.type, M + 'LineSegment');
  assert.deepEqual(geometry.properties.Point, {valueType: F + 'Point', X: 3, Y: 4});
  assert.equal(geometry.Point, geometry.properties.Point);
});
