import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePath, pathToSvg} from '../packages/rendering/src/geometry/path-markup.js';
import {RectangleGeometry, EllipseGeometry, GeometryGroup, normalizeGeometry} from '../packages/rendering/src/geometry/path-geometry.js';
import {geometryBounds, flattenGeometry, fillContains} from '../packages/rendering/src/geometry/geometry-math.js';
import {multiply, translation, scaling, rotation, transformPoint, inverse, transformValue} from '../packages/rendering/src/media/transforms.js';

const near = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const boundsNear = (actual, expected) => actual.forEach((value, index) => near(value, expected[index]));
function triangleArea(triangles) {
  let area = 0;
  for (let index = 0; index < triangles.length; index += 6) {
    area += Math.abs((triangles[index + 2] - triangles[index]) * (triangles[index + 5] - triangles[index + 1]) -
      (triangles[index + 3] - triangles[index + 1]) * (triangles[index + 4] - triangles[index])) / 2;
  }
  return area;
}

test('path mini-language normalizes all command families, exponents, relative moves and smooth control reflection', () => {
  const source = 'F1 M1e1 0 l10 0 h10 v10 c0 10 10 10 10 0 s10 -10 10 0 q10 10 20 0 t20 0 a8 4 30 0 1 10 5 z';
  const path = parsePath(source);
  assert.equal(path.fillRule, 'nonzero');
  assert.equal(path.figures[0].closed, true);
  assert.deepEqual(path.figures[0].segments[4].control1, [40, 0]);
  assert.deepEqual(parsePath('F1 ' + pathToSvg(path)), path);
  assert.deepEqual(parsePath('M0 0 10 10 20 0').figures[0].segments.map(segment => segment.end), [[10, 10], [20, 0]]);
  for (const source of ['L1 1', 'M0', 'M0 0 Z 1 1', 'F2 M0 0', 'M0 0 R1 2']) assert.throws(() => parsePath(source));
});

test('tight Bezier and transformed ellipse bounds use curve extrema, not control boxes', () => {
  boundsNear(geometryBounds(parsePath('M0 0 Q10 20 20 0')), [0, 0, 20, 10]);
  boundsNear(geometryBounds(parsePath('M0 0 C0 30 30 30 30 0')), [0, 0, 30, 22.5]);
  const extent = Math.sqrt(250);
  boundsNear(geometryBounds(new EllipseGeometry([0, 0], 10, 20), rotation(45)), [-extent, -extent, extent * 2, extent * 2]);
  const child = new RectangleGeometry([0, 0, 2, 3]); child.transform = translation(10, 5);
  const group = new GeometryGroup([child]); group.transform = scaling(2, 3);
  boundsNear(geometryBounds(group), [20, 15, 4, 9]);
});

test('geometry and transforms reject malformed native data, cycles and singular inverses', () => {
  const group = new GeometryGroup(); group.children.push(group);
  assert.throws(() => geometryBounds(group), error => error.code === 'SFRENDER040');
  assert.throws(() => normalizeGeometry({kind: 'path', figures: [{start: [0, 0], segments: [{kind: 'script', end: [1, 1]}]}]}),
    error => error.code === 'SFRENDER039');
  assert.throws(() => normalizeGeometry({kind: 'ellipse', rect: [0, 0, -1, 2]}), error => error.code === 'SFRENDER001');
  const transform = multiply(translation(12, -8), multiply(rotation(30), scaling(2, 3)));
  const point = [4, 7]; boundsNear(transformPoint(inverse(transform), transformPoint(transform, point)), point);
  assert.equal(inverse([1, 2, 2, 4, 0, 0]), null);
  const typed = {type: 'Microsoft.UI.Xaml.Media.TransformGroup', properties: {Children: [
    {type: 'TranslateTransform', properties: {X: 5}}, {type: 'ScaleTransform', properties: {ScaleX: 2, ScaleY: 3}}]}};
  assert.deepEqual(transformPoint(transformValue(typed), [1, 1]), [12, 3]);
  typed.properties.Children.push(typed);
  assert.throws(() => transformValue(typed), error => error.code === 'SFRENDER020');
});
