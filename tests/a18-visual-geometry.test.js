import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignSpatialIndex, DesignOutlineIndex, DesignSnaplines, coordinateStack, inverseMatrix, multiplyMatrix,
  localPointerDelta, resizeRectangle, transformPoint, transformRectangle, arrangeRectangles, validateGuideSettings} from '@sharpforge/designer';

const approximately = (actual, expected) => assert(Math.abs(actual - expected) <= 1e-9, `${actual} ≠ ${expected}`);
const rectangle = (Left, Top, Width = 20, Height = 10) => ({Left, Top, Width, Height});

test('affine stack maps scroll, rotated/scaled ancestors and 200% zoom to exact local deltas', () => {
  const matrix = coordinateStack([
    {x: 100, y: 80, scrollX: 12, scrollY: 7, transform: [0, 2, -3, 0, 0, 0], origin: {x: 15, y: 8}},
    {x: 31, y: 47, scrollX: 3, scrollY: 4}
  ], [2, 0, 0, 2, 0, 0]);
  const start = transformPoint(matrix, {x: 10, y: 20});
  const end = transformPoint(matrix, {x: 19.25, y: 34.5});
  const delta = localPointerDelta(matrix, start, end);
  approximately(delta.x, 9.25);
  approximately(delta.y, 14.5);
  assert.deepEqual(resizeRectangle(rectangle(0, 0, 100, 50), 'se', delta), rectangle(0, 0, 109.25, 64.5));
  multiplyMatrix(matrix, inverseMatrix(matrix)).forEach((coefficient, index) => {
    approximately(coefficient, [1, 0, 0, 1, 0, 0][index]);
  });
});

test('geometry rejects singular, malformed, excessively nested and inverted inputs', () => {
  assert.throws(() => inverseMatrix([0, 0, 0, 1, 0, 0]), {code: 'SFD_GEOMETRY_SINGULAR'});
  assert.throws(() => inverseMatrix([1, NaN, 0, 1, 0, 0]), {code: 'SFD_GEOMETRY_MATRIX'});
  assert.throws(() => coordinateStack(Array.from({length: 129}, () => ({}))), {code: 'SFD_GEOMETRY_DEPTH'});
  assert.throws(() => transformRectangle(rectangle(0, 0, -1), [1, 0, 0, 1, 0, 0]), {code: 'SFD_GEOMETRY_RECTANGLE'});
  assert.throws(() => resizeRectangle(rectangle(0, 0), 'bad', {x: 1, y: 1}), {code: 'SFD_GEOMETRY_HANDLE'});
});

test('west/north resizing keeps the opposite edge and honors dimension constraints', () => {
  assert.deepEqual(resizeRectangle(rectangle(10, 20, 100, 80), 'nw', {x: 120, y: 100},
    {minWidth: 10, minHeight: 20}), rectangle(100, 80, 10, 20));
  assert.deepEqual(resizeRectangle(rectangle(10, 20, 100, 80), 'se', {x: 1000, y: 1000},
    {maxWidth: 150, maxHeight: 120}), rectangle(10, 20, 150, 120));
});

test('snaplines find sibling edges, centers, baselines, user guides and equal spacing', () => {
  const snap = new DesignSnaplines({siblings: [
    {id: 'first', bounds: rectangle(10, 10), baseline: 7}, {id: 'second', bounds: rectangle(40, 10), baseline: 7}
  ], guides: [{id: 'guide', axis: 'x', position: 100}]});
  const edge = snap.snap(rectangle(44, 50));
  assert.equal(edge.bounds.Left, 40);
  assert(edge.guides.some(guide => guide.target === 'second'));
  const centered = snap.snap(rectangle(18, 50, 4));
  assert.equal(centered.bounds.Left, 18);
  const baseline = snap.snap(rectangle(150, 12, 20, 10), {baseline: 7});
  assert.equal(baseline.bounds.Top, 10);
  assert.equal(snap.snap(rectangle(104, 90)).bounds.Left, 100);
  const spacing = snap.snap(rectangle(74, 100));
  assert.equal(spacing.bounds.Left, 70);
  assert(spacing.guides.some(guide => guide.kind === 'spacing' && guide.gap === 10));
});

test('Alt completely disables grid and target snapping, including fractional pixels', () => {
  const snap = new DesignSnaplines({snapGrid: true, siblings: [{id: 'a', bounds: rectangle(10, 10)}]});
  const bounds = rectangle(11.125, 15.375);
  assert.deepEqual(snap.snap(bounds, {disabled: true}), {bounds, delta: {x: 0, y: 0}, guides: []});
  assert.equal(new DesignSnaplines({snapGrid: true}).snap(rectangle(11, 13)).bounds.Left, 8);
  assert.throws(() => new DesignSnaplines({tolerance: NaN}), {code: 'SFD_SNAP_TOLERANCE'});
  assert.throws(() => new DesignSnaplines({gridSize: 0}), {code: 'SFD_SNAP_GRID'});
});

test('spatial index clips 5000 nodes, updates entries, supports negative and very large bounds', () => {
  const index = new DesignSpatialIndex();
  for (let offset = 0; offset < 5000; offset++) index.set(String(offset), rectangle(offset * 30, 0));
  assert.deepEqual(index.search(rectangle(50, 0, 30, 10)).map(item => item.id), ['1', '2']);
  index.set('1', rectangle(-20, -20));
  assert.deepEqual(index.search(rectangle(-20, -20)).map(item => item.id), ['1']);
  index.set('large', rectangle(-100000, -100000, 200000, 200000));
  assert(index.search(rectangle(0, 0)).some(item => item.id === 'large'));
  assert(index.search(rectangle(-100000, -100000, 500000, 500000), {limit: 3}).length === 3);
  assert.equal(index.delete('large'), true);
  index.clear();
  assert.equal(index.items.size, 0);
});

test('outline flattening and viewport rows stay bounded for a 5000-node document', () => {
  const document = {root: 'root', nodes: [{id: 'root', children: []}]};
  for (let index = 1; index < 5000; index++) {
    document.nodes[0].children.push(String(index));
    document.nodes.push({id: String(index), children: []});
  }
  const outline = new DesignOutlineIndex(document);
  const viewport = outline.viewport({scrollTop: 24000, height: 480});
  assert.equal(viewport.totalHeight, 120000);
  assert(viewport.rows.length <= 28);
  assert.equal(viewport.rows[4].id, '1000');
  assert.throws(() => new DesignOutlineIndex({root: 'a', nodes: [{id: 'a', children: ['a']}]}), {code: 'SFD_OUTLINE_TREE'});
});

test('arrangement aligns to the primary selection and distributes equal gaps', () => {
  const rectangles = {a: rectangle(10, 10, 20, 20), b: rectangle(60, 40, 30, 40), c: rectangle(140, 80, 40, 30)};
  assert.equal(arrangeRectangles(rectangles, 'right').c.Left, -10);
  assert.equal(arrangeRectangles(rectangles, 'middle').b.Top, 0);
  const distributed = arrangeRectangles(rectangles, 'distribute-h');
  assert.equal(distributed.b.Left, 70);
  assert.deepEqual(arrangeRectangles(rectangles, 'same-size').c, rectangle(140, 80, 20, 20));
  assert.throws(() => arrangeRectangles({a: rectangles.a}, 'left'), {code: 'SFD_ARRANGE_SELECTION'});
  assert.throws(() => arrangeRectangles(rectangles, 'mystery'), {code: 'SFD_ARRANGE_ACTION'});
});

test('guide settings preserve finite fractional locations and reject duplicate identifiers', () => {
  const settings = validateGuideSettings({gridSize: .25, guides: [{id: 'x', axis: 'x', position: -1.125}]});
  assert.equal(settings.guides[0].position, -1.125);
  assert.throws(() => validateGuideSettings({guides: [{id: 'x', axis: 'x', position: 1},
    {id: 'x', axis: 'y', position: 2}]}), {code: 'SFD_GUIDE_ID'});
  assert.throws(() => validateGuideSettings({gridSize: 0}), {code: 'SFD_GUIDE_GRID'});
});
