import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {DesignDocument, DesignGeometrySession, DesignSnaplines, DesignSpatialIndex, createDesign,
  editGridTracks, setResponsiveState, setUserGuide} from '@sharpforge/designer';

/** Runnable authoring example: node packages/designer/examples/visual-layout.mjs */
export function createVisualAuthoringExample() {
  const document = new DesignDocument(createDesign('Adaptive authoring example'));
  const grid = document.add('Grid', 'canvas', {Name: 'ResponsiveGrid', Width: 640, Height: 360, Left: 40, Top: 240});
  document.tracks(grid, ['Auto', '*'], [120, '*']);
  document.move('action', grid);
  editGridTracks(document, {id: grid, axis: 'columns', action: 'insert', index: 1, value: '2*'});
  setUserGuide(document, {axis: 'x', position: 40});
  setResponsiveState(document, {id: 'Compact', minWidth: 0, maxWidth: 600,
    overrides: {[grid]: {Width: 300}, action: {Width: 120, Column: 0}}});
  setResponsiveState(document, {id: 'Wide', minWidth: 600, maxWidth: null,
    overrides: {[grid]: {Width: 640}, action: {Width: 240, Column: 1}}});
  return document;
}

const percentiles = values => {
  const sorted = [...values].sort((left, right) => left - right);
  return {medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)],
    p99Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .99))]};
};

/** Actual JavaScript geometry work; browser paint and native WinUI qualification are reported separately. */
export function benchmarkVisualAuthoring({nodes = 5000, samples = 200} = {}) {
  const beforeHeap = process.memoryUsage().heapUsed;
  const cold = performance.now();
  const siblings = Array.from({length: nodes}, (_, index) => ({id: `n${index}`,
    bounds: {Left: index % 100 * 40, Top: Math.floor(index / 100) * 40, Width: 24, Height: 24}}));
  const index = new DesignSpatialIndex();
  for (const sibling of siblings) index.set(sibling.id, sibling.bounds);
  const snaplines = new DesignSnaplines({siblings, snapGrid: false});
  const coldMs = performance.now() - cold;
  const document = new DesignDocument(createDesign());
  const session = new DesignGeometrySession(document,
    {rectangles: {action: {Left: 50, Top: 162, Width: 160, Height: 40}}});
  const timings = [];
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    session.update({x: sample + .125, y: sample / 2}, {snaplines});
    index.search({Left: sample, Top: sample, Width: 800, Height: 600}, {limit: 200});
    timings.push(performance.now() - start);
  }
  session.cancel();
  return {backend: 'JavaScript indexed geometry; no DOM/native renderer', nodeVersion: process.version,
    nodes, samples, coldMs, warm: percentiles(timings), heapDeltaBytes: process.memoryUsage().heapUsed - beforeHeap,
    allocations: 'heap delta includes retained index/snap arrays; GC-sensitive, not total allocation count'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({example: createVisualAuthoringExample().snapshot(), benchmark: benchmarkVisualAuthoring()}, null, 2));
}
