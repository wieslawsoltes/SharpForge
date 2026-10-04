import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePath, pathToSvg} from '../packages/rendering/src/geometry/path-markup.js';
import {dashContours, normalizePen, strokeContours, strokeContains} from '../packages/rendering/src/geometry/stroke.js';

const contour = (points, closed = false) => ({points, closed, filled: true});
const diagnostic = code => error => error.code === code;

test('arc scanner reads concatenated flags and the adjacent coordinate without changing canonical geometry', () => {
  const compact = parsePath('M0 0 A10 10 0 0110 20 a5 8 30 10-5-6');
  const spaced = parsePath('M0 0 A10 10 0 0 1 10 20 a5 8 30 1 0 -5 -6');
  assert.deepEqual(compact, spaced);
  assert.deepEqual(parsePath(pathToSvg(compact)), compact);
  const repeated = parsePath('M0 0 A10 10 0 0110 20 10 10 0 00.5.25');
  assert.deepEqual(repeated.figures[0].segments[1].end, [0.5, 0.25]);
  assert.throws(() => parsePath('M0 0 A10 10 0 0210 20'), error => error.code === 'SFRENDER037' && error.offset === 15);
  assert.throws(() => parsePath('M0 0 A10 10 0 0+1 10 20'), diagnostic('SFRENDER037'));
});

test('path scanner retains exponent signs, character offsets and segment budgets', () => {
  assert.deepEqual(parsePath('M1e2-.5L1e-2+3').figures[0].segments[0].end, [0.01, 3]);
  assert.throws(() => parsePath('M0 0L? 1'), error => error.code === 'SFRENDER030' && error.offset === 5);
  assert.throws(() => parsePath('M0 0L1 1', {maxSegments: 0}), diagnostic('SFRENDER031'));
  assert.throws(() => parsePath('M0 0', {maxCharacters: 3}), diagnostic('SFRENDER031'));
  assert.equal(parsePath('M0 0 ' + 'l1 0 '.repeat(4000)).figures[0].segments.length, 4000);
});

test('zero-length on-dashes produce round and square dots at exact endpoints', () => {
  const path = [contour([0, 0, 8, 0])];
  const input = {width: 2, dash: [0, 2], dashCap: 'round'};
  const dots = dashContours(path, normalizePen(input));
  assert.deepEqual(dots.map(dot => dot.points), [[0, 0], [4, 0], [8, 0]]);
  assert.equal(strokeContains(path, [0, 0.8], input), true);
  assert.equal(strokeContains(path, [2, 0], input), false);
  assert.equal(strokeContains(path, [4.8, 0.8], {...input, dashCap: 'round'}), false);
  assert.equal(strokeContains(path, [4.8, 0.8], {...input, dashCap: 'square'}), true);
  assert.equal(strokeContours(path, {...input, dashCap: 'butt'}).length, 0);
});

test('closed dashed contours join the seam and continuous zero gaps preserve closure', () => {
  const square = [contour([0, 0, 10, 0, 10, 10, 0, 10], true)];
  const pieces = dashContours(square, normalizePen({width: 1, dash: [10, 10], dashOffset: 5}));
  assert.equal(pieces.length, 2);
  assert.deepEqual(pieces[0].points, [0, 5, 0, 0, 5, 0]);
  const solid = dashContours(square, normalizePen({width: 1, dash: [2, 0]}));
  assert.equal(solid.length, 1);
  assert.equal(solid[0].closed, true);
  assert.notDeepEqual(solid[0].points.slice(0, 2), solid[0].points.slice(-2));
  assert.equal(strokeContains(square, [-0.4, -0.4], {width: 1, dash: [10, 10], dashOffset: 5, join: 'miter'}), true);
});

test('dash splitting and stroke geometry fail explicitly before unbounded tiny-pattern output', () => {
  const path = [contour([0, 0, 100, 0])];
  assert.throws(() => dashContours(path, normalizePen({width: 1, dash: [1e-200, 1e-200]})), diagnostic('SFRENDER045'));
  assert.throws(() => dashContours(path, normalizePen({width: 1, dash: [1, 1]}), {maxDashContours: 2}), diagnostic('SFRENDER045'));
  assert.throws(() => dashContours(path, normalizePen({width: 1, dash: [1, 1]}), {maxDashPoints: 2}), diagnostic('SFRENDER045'));
  assert.throws(() => strokeContours(path, {width: 2, dash: [0, 2], dashCap: 'round'}, {maxStrokeVertices: 20}), diagnostic('SFRENDER045'));
  assert.throws(() => normalizePen({dash: [0, 0]}), diagnostic('SFRENDER044'));
  assert.throws(() => normalizePen({dash: {length: 1000000000}}), diagnostic('SFRENDER044'));
});
