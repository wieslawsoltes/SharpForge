import test from 'node:test';
import assert from 'node:assert/strict';
import {transformPoint, DesignSnaplines} from '@sharpforge/designer';
import {DesignerSurfaceGestures} from '../apps/studio/designer-surface-gestures.js';
import {surfaceMetrics} from './fixtures/a18-surface-metrics.js';

test('outer scrolling preserves all 5000 measured bounds and baselines with one viewport read', () => {
  const fixture = surfaceMetrics();
  const {geometry, state} = fixture;
  geometry.refresh({all: true});
  const entry = geometry.get('n4000');
  const matrix = [...entry.matrix];
  const parent = [...entry.parentMatrix];
  const bounds = {...entry.bounds};
  const snap = entry.snap;
  const reads = state.reads;
  const baselines = state.baselines;
  state.x -= 37.5;
  state.y -= 12.25;
  assert.equal(geometry.viewportChanged(), true);
  assert.equal(geometry.get('n4000'), entry);
  assert.equal(entry.snap, snap);
  assert.deepEqual(entry.bounds, bounds);
  assert.deepEqual(entry.matrix, [...matrix.slice(0, 4), matrix[4] - 37.5, matrix[5] - 12.25]);
  assert.deepEqual(entry.parentMatrix, [...parent.slice(0, 4), parent[4] - 37.5, parent[5] - 12.25]);
  assert.deepEqual(geometry.localPoint('n4000', transformPoint(entry.matrix, {x: 5, y: 6})), {x: 5, y: 6});
  assert.equal(state.reads, reads + 1);
  assert.equal(state.baselines, baselines);
  assert.equal(state.fonts, 1);
  assert.equal(geometry.entries.size, 5000);
  fixture.dispose();
});

test('scrolling preserves bounded pending measurement work and disposal cancels it', () => {
  const fixture = surfaceMetrics();
  const {geometry, state, frames, tick} = fixture;
  geometry.refresh();
  const pending = geometry.pending;
  const frame = geometry.frame;
  const first = geometry.get('n0');
  state.y -= 100;
  assert.equal(geometry.viewportChanged(), true);
  assert.equal(geometry.pending, pending);
  assert.equal(geometry.frame, frame);
  const reads = state.reads;
  tick();
  assert(state.reads - reads < 40, 'A scroll forced synchronous completion of all geometry measurements.');
  assert.equal(geometry.get('n0'), first);
  assert(geometry.pending);
  fixture.dispose();
  assert.equal(frames.size, 0);
  assert.equal(geometry.entries.size, 0);
});

test('a temporary ancestor remeasure cannot leave a sibling on stale client coordinates after scrolling', () => {
  const fixture = surfaceMetrics(10);
  const {geometry, state} = fixture;
  geometry.refresh({all: true});
  const sibling = geometry.get('n0');
  const previous = sibling.parentMatrix;
  geometry.remeasure(['n1']);
  assert.notEqual(geometry.get('canvas').matrix, previous);
  state.x -= 20;
  state.y -= 40;
  geometry.viewportChanged();
  assert.equal(geometry.get('n0'), sibling);
  assert.equal(sibling.parentMatrix, geometry.get('canvas').matrix);
  assert.deepEqual(transformPoint(sibling.parentMatrix, {x: 0, y: 0}), {x: state.x, y: state.y});
  fixture.dispose();
});

test('scene replacement and changed viewport scale invalidate instead of reusing stale measured layout', () => {
  const fixture = surfaceMetrics(10);
  const {geometry, view, state} = fixture;
  geometry.refresh({all: true});
  const original = geometry.get('n0');
  view.host.sceneRevision++;
  assert.equal(geometry.viewportChanged(), false);
  geometry.refresh();
  assert.notEqual(geometry.get('n0'), original);
  const afterScene = geometry.get('n0');
  state.zoom = 3;
  assert.equal(geometry.viewportChanged(), false);
  geometry.refresh();
  assert.notEqual(geometry.get('n0'), afterScene);
  assert.equal(geometry.get('n0').matrix[0], 3);
  fixture.dispose();
});

test('gesture targets reuse parent-relative cached geometry after scrolling without reentering every control reader', () => {
  const fixture = surfaceMetrics();
  const {geometry, view, state} = fixture;
  geometry.refresh({all: true});
  state.y -= 100;
  geometry.viewportChanged();
  let lookups = 0;
  const get = geometry.get.bind(geometry);
  geometry.get = id => { lookups++; return get(id); };
  const gestures = new DesignerSurfaceGestures({view, geometry});
  const before = {reads: state.reads, baselines: state.baselines};
  const targets = gestures.snaplines('canvas', ['n255']);
  assert.equal(lookups, 1, 'Starting a gesture reentered geometry readers for every sibling.');
  assert.deepEqual({reads: state.reads, baselines: state.baselines}, before);
  assert(targets.lines.x.length > 100);
  assert(targets.lines.y.some(line => line.kind === 'baseline'));
  assert([...targets.lines.x, ...targets.lines.y].every(line => line.target !== 'n255'));
  gestures.dispose();
  fixture.dispose();
});

test('the baseline adapter accepts missing baselines and a null optional parent transform', () => {
  const gestures = new DesignerSurfaceGestures({view: {}});
  assert.equal(gestures.baseline({baseline: null}, 0), null);
  assert.equal(gestures.baseline({baseline: 12, parentMatrix: [1, 0, 0, 1, 50, 30],
    matrix: [1, 0, 0, 1, 60, 35]}, 5, null), 12);
  assert.equal(gestures.baseline({baseline: 12}, 0, [0, 1, -1, 0, 0, 0]), null);
});

test('coincident snap targets retain stable edge, baseline and equal-spacing choices', () => {
  const siblings = Array.from({length: 5000}, (_, index) => ({id: `n${index}`, baseline: 7,
    bounds: {Left: index % 2 ? 40 : 10, Top: 10, Width: 20, Height: 10}}));
  const snap = new DesignSnaplines({siblings, guides: [{id: 'guide', axis: 'x', position: 100}]});
  assert.equal(snap.lines.x.find(line => line.position === 10 && line.kind === 'edge').target, 'n0');
  assert.equal(snap.lines.y.find(line => line.kind === 'baseline').target, 'n0');
  assert.equal(snap.lines.x.length, 7);
  const spaced = snap.snap({Left: 74, Top: 100, Width: 20, Height: 10});
  assert.equal(spaced.bounds.Left, 70);
  assert(spaced.guides.some(line => line.kind === 'spacing' && line.target === 'n1' && line.other === 'n4998' && line.gap === 10));
  assert.equal(snap.snap({Left: 104, Top: 100, Width: 20, Height: 10}).bounds.Left, 100);
});
