import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, createDesign, multiplyMatrix, transformPoint, transformRectangle, updateGuideSettings} from '@sharpforge/designer';
import {DesignerSurfaceGestures} from '../apps/studio/designer-surface-gestures.js';
import {DesignerTextBaselines} from '../apps/studio/designer-surface-baseline.js';

const identity = [1, 0, 0, 1, 0, 0];
const approximately = (actual, expected) => assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('measured font baseline retains local position under zoom and rotated ancestor transforms', () => {
  let reads = 0;
  let rectangle;
  const document = {
    createElement: () => ({getContext: () => ({measureText() {
      reads++;
      return {fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 5};
    }})}),
    createRange: () => ({selectNodeContents() {}, getClientRects: () => [rectangle], detach() {}})
  };
  const baselines = new DesignerTextBaselines(document);
  const diagonal = Math.sqrt(2);
  for (const matrix of [identity, [0, 2, -2, 0, 100, 200], [diagonal, diagonal, -diagonal, diagonal, 20, 40]]) {
    const bounds = transformRectangle({Left: 8, Top: 4, Width: 100, Height: 17}, matrix);
    rectangle = {left: bounds.Left, top: bounds.Top, width: bounds.Width, height: bounds.Height};
    const baseline = baselines.measure({matrix, style: {font: '16px TestFont'},
      element: {childNodes: [{nodeType: 3, textContent: 'Measured text'}]}});
    approximately(baseline, 16);
  }
  assert.equal(reads, 1, 'Repeated control measurements reuse font metrics');
  assert.equal(baselines.measure({element: {childNodes: []}}), null);
  baselines.dispose();
  assert.equal(baselines.fonts.size, 0);
  assert.equal(baselines.context, null);
});

function pointerFixture(matrix = identity) {
  const document = new DesignDocument(createDesign());
  document.setProperty('Top', 50, ['action']);
  document.setProperty('Height', 12, ['action']);
  document.select('action');
  updateGuideSettings(document, {snapGrid: false});
  const entries = new Map();
  const entry = (id, rectangle, baseline) => ({id, node: document.node(id), rectangle, baseline,
    width: rectangle.Width, height: rectangle.Height, style: {}, parentMatrix: matrix,
    matrix: multiplyMatrix(matrix, [1, 0, 0, 1, rectangle.Left, rectangle.Top])});
  entries.set('canvas', {id: 'canvas', node: document.node('canvas'), matrix, stageMatrix: identity, width: 960, height: 640});
  entries.set('action', entry('action', {Left: 50, Top: 50, Width: 160, Height: 12}, 9));
  entries.set('title', entry('title', {Left: 400, Top: 20, Width: 40, Height: 80}, 60));
  const output = {bounds: null, guides: []};
  const view = {document, preview: false, host: {nodes: new Map()}, scroller: {focus() {}}};
  const controller = {view, geometry: {get: id => entries.get(id)}, multiply: multiplyMatrix,
    zoom: {space: false}, drawing: {start: () => false}, drawAdorners() {},
    adorners: {paint: bounds => { output.bounds = structuredClone(bounds); }, guides: guides => { output.guides = guides; }},
    trackPointer: (_event, move, commit, cancel) => { output.pointer = {move, commit, cancel}; }};
  const gestures = new DesignerSurfaceGestures(controller);
  const start = transformPoint(matrix, {x: 0, y: 0});
  const event = {button: 0, clientX: start.x, clientY: start.y, preventDefault() {}, stopPropagation() {},
    target: {closest: selector => selector === '[data-sf-id]' ? {dataset: {sfId: 'action'}} : null}};
  return {document, gestures, entries, output, event, matrix};
}

test('real pointer gesture passes the moving baseline through snapping and commits one exact undo', () => {
  const {document, gestures, output, event, matrix} = pointerFixture([0, 2, -2, 0, 100, 200]);
  const before = document.serialize();
  const history = document.undoStack.length;
  gestures.pointerDown(event);
  const point = transformPoint(matrix, {x: 0, y: 19});
  for (let repeat = 0; repeat < 100; repeat++) output.pointer.move({clientX: point.x, clientY: point.y});
  approximately(output.bounds.action.Top, 71);
  assert(output.guides.some(guide => guide.kind === 'baseline' && guide.target === 'title'));
  assert.equal(document.serialize(), before);
  output.pointer.commit();
  approximately(document.node('action').properties.Top, 71);
  assert.equal(document.undoStack.length, history + 1);
  document.undo();
  assert.equal(document.serialize(), before);
});

test('Alt bypass and canceled baseline gestures preserve source, selection and history', () => {
  const {document, gestures, output, event} = pointerFixture();
  const before = document.serialize();
  const history = document.undoStack.length;
  gestures.pointerDown(event);
  output.pointer.move({clientX: 0, clientY: 19, altKey: true});
  assert.equal(output.bounds.action.Top, 69);
  assert.deepEqual(output.guides, []);
  output.pointer.cancel();
  assert.equal(document.serialize(), before);
  assert.equal(document.undoStack.length, history);
  assert.deepEqual(document.selection, ['action']);
});

test('a control whose own text baseline is rotated is excluded from horizontal baseline targets', () => {
  const {gestures, entries} = pointerFixture();
  entries.get('title').matrix = [0, 1, -1, 0, 400, 20];
  const targets = gestures.snaplines('canvas', ['action']);
  assert(!targets.lines.y.some(line => line.kind === 'baseline'));
  assert(targets.lines.y.some(line => line.kind === 'edge'));
});
