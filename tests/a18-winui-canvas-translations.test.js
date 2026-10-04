import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, DesignPreviewEnvironment, createDesign, designScene} from '@sharpforge/designer';
import {DesignerPreviewProjection} from '../apps/studio/designer-preview-projection.js';
import {canvasScene, geometryHost} from './fixtures/a18-host-geometry-dom.js';

function patch(host, properties, {flush = true} = {}) {
  assert.equal(host.tryPatchProperties([{id: 'item2', properties}]), true);
  if (flush) host.flush();
}

function rotatedScene() {
  const scene = canvasScene(4);
  scene.nodes[2].properties.RenderTransform = {$ref: 'rotation'};
  scene.nodes.push({id: 'rotation', type: 'Microsoft.UI.Xaml.Media.RotateTransform', events: [], collections: {},
    properties: {Angle: 90, CenterX: 17, CenterY: 13}});
  return scene;
}

/** Explicit computed-style boundary for the fake DOM; real affine bounds are qualified independently in Chromium. */
function computedTranslation(element, linear = [1, 0, 0, 1]) {
  const match = /^translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(element.style.transform);
  return `matrix(${linear.join(', ')}, ${match?.[1] ?? 0}, ${match?.[2] ?? 0})`;
}

test('repeated and queued positions retain one layout origin without accumulating offsets or losing measurements', () => {
  const {host, rendered, measured, layouts} = geometryHost(canvasScene(4));
  const element = host.elements.get('item2');
  for (let index = 1; index <= 200; index++) {
    patch(host, {Left: index / 4 - 30, Top: index / 8 + 10});
    assert.equal(host.nodes.get('item2').properties.Left, index / 4 - 30);
    assert.equal(host.nodes.get('item2').properties.Top, index / 8 + 10);
    assert.equal(element.style.transform, `translate(${index / 4 - 32}px, ${index / 8 + 8}px)`);
  }
  patch(host, {Left: -10.5}, {flush: false});
  patch(host, {Left: 8.25, Top: -9.75}, {flush: false});
  host.flush();
  assert.equal(element.style.transform, 'translate(6.25px, -11.75px)');
  assert.equal(element.style.left, '2px');
  assert.equal(element.style.top, '2px');
  assert.equal(host.geometryUpdates.translations.records.size, 1);
  assert.deepEqual(rendered, []);
  assert.equal(measured.length, 201, 'Every completed update still reads the current browser size synchronously.');
  assert.deepEqual(new Set(measured), new Set(['item2']));
  assert.deepEqual(layouts, [], 'A pure position update cannot report a fabricated size change.');
  host.dispose();
});

test('clearing one absolute coordinate restores its default while reversing both offsets restores the exact inline transform', () => {
  const {host} = geometryHost(canvasScene(4));
  const element = host.elements.get('item2');
  const initial = element.style.transform;
  patch(host, {Left: 20, Top: -10});
  patch(host, {Left: undefined});
  assert.equal(Object.hasOwn(host.nodes.get('item2').properties, 'Left'), false);
  assert.equal(element.style.transform, 'translate(-2px, -12px)');
  patch(host, {Left: 2, Top: 2});
  assert.equal(element.style.transform, initial);
  assert.equal(element.style.left, '2px');
  assert.equal(element.style.top, '2px');
  host.dispose();
});

test('an existing affine transform and its nonzero origin survive parent-coordinate translation and exact reversal', () => {
  const {host, rendered, measured} = geometryHost(rotatedScene());
  const element = host.elements.get('item2');
  host.document.defaultView.getComputedStyle = element => ({transform: computedTranslation(element, [0, 1, -1, 0])});
  assert.equal(element.style.transform, 'rotate(90deg)');
  assert.equal(element.style.transformOrigin, '17px 13px');
  patch(host, {Left: 10, Top: -5});
  assert.equal(element.style.transform, 'translate(8px, -7px) rotate(90deg)');
  assert.equal(element.style.transformOrigin, '17px 13px');
  patch(host, {Left: 2, Top: 2});
  assert.equal(element.style.transform, 'rotate(90deg)');
  assert.equal(element.style.transformOrigin, '17px 13px');
  assert.deepEqual(rendered, []);
  assert.deepEqual(measured, ['item2', 'item2']);
  host.dispose();
});

test('a rejected multi-node batch cannot replace existing translation records or publish a new partial record', () => {
  const {host} = geometryHost(canvasScene(5));
  patch(host, {Left: 8});
  const records = host.geometryUpdates.translations.records;
  const retained = records.get('item2');
  const original = structuredClone(host.nodes.get('item2').properties);
  const revision = host.sceneRevision;
  for (const first of ['item2', 'item3']) {
    assert.equal(host.tryPatchProperties([
      {id: first, properties: {Left: 90}},
      {id: 'item4', properties: {Content: 'Needs dependency processing'}}
    ]), false);
    assert.equal(records.size, 1);
    assert.equal(records.get('item2'), retained);
    assert.deepEqual(host.nodes.get('item2').properties, original);
    assert.equal(host.nodes.get('item3').properties.Left, 3);
    assert.equal(host.sceneRevision, revision);
    assert.equal(host.frame, 0);
  }
  host.dispose();
});

test('resize queued before or between positions always performs the required node layout before retaining another move', () => {
  for (const beginWithMove of [false, true]) {
    const {host, rendered, measured, reset} = geometryHost(canvasScene(4));
    if (beginWithMove) patch(host, {Left: 8}, {flush: false});
    patch(host, {Width: 248}, {flush: false});
    patch(host, {Left: 13, Top: 14}, {flush: false});
    host.flush();
    const element = host.elements.get('item2');
    assert.equal(element.style.left, '13px');
    assert.equal(element.style.top, '14px');
    assert.equal(element.style.width, '248px');
    assert.equal(element.style.transform, '');
    assert.deepEqual(rendered, ['item2']);
    assert.deepEqual(measured, ['item2']);
    assert.equal(host.geometryUpdates.translations.records.size, 0);
    reset();
    patch(host, {Left: 19});
    assert.equal(element.style.transform, 'translate(6px, 0px)');
    assert.deepEqual(rendered, []);
    host.dispose();
  }
});

test('unsupported transform representations and unset dimensions preserve the ordinary node-render fallback', () => {
  for (const style of [
    {transform: 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'},
    {transform: 'matrix(1, 0, 0, 1, 0, 0)', translate: '12px 8px'},
    {transform: 'none', rotate: '30deg'},
    {transform: 'none', scale: '2'},
    {transform: 'none', offsetPath: 'path("M0,0 L10,10")'},
    {transform: 'matrix(1, 0, 0, 1, 0, 0)', animationName: 'sf-winui-spin'},
    {transform: 'none', transitionDuration: '0s, 0.2s'},
    {transform: 'matrix(1, 0, 0, 1, NaN, 0)'}
  ]) {
    const {host, rendered} = geometryHost(canvasScene(4));
    host.document.defaultView.getComputedStyle = () => style;
    patch(host, {Left: 18});
    assert.equal(host.elements.get('item2').style.left, '18px');
    assert.deepEqual(rendered, ['item2']);
    assert.equal(host.geometryUpdates.translations.records.size, 0);
    host.dispose();
  }
  const scene = canvasScene(4);
  delete scene.nodes[2].properties.Width;
  const {host, rendered} = geometryHost(scene);
  patch(host, {Left: 18});
  assert.deepEqual(rendered, ['item2']);
  assert.equal(host.geometryUpdates.translations.records.size, 0);
  host.dispose();
});

test('external transform or origin mutations discard a retained offset before the authoritative node render', () => {
  for (const property of ['transform', 'transformOrigin']) {
    const {host, rendered, reset} = geometryHost(canvasScene(4));
    patch(host, {Left: 18});
    host.elements.get('item2').style[property] = property === 'transform' ? 'rotate(25deg)' : '30px 12px';
    reset();
    patch(host, {Left: 19});
    const element = host.elements.get('item2');
    assert.equal(element.style.left, '19px');
    assert.equal(element.style.transform, '');
    assert.equal(element.style.transformOrigin, '');
    assert.deepEqual(rendered, ['item2']);
    assert.equal(host.geometryUpdates.translations.records.size, 0);
    host.dispose();
  }
});

test('CSS motion or individual transforms enabled after a retained move invalidate its next position update', () => {
  for (const changed of [
    {animationName: 'sf-winui-spin'}, {transitionDuration: '0.15s'}, {rotate: '30deg'}, {translate: '12px 8px'},
    {transform: 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'}
  ]) {
    const {host, rendered, reset} = geometryHost(canvasScene(4));
    let style = {animationName: 'none', transitionDuration: '0s'};
    host.document.defaultView.getComputedStyle = element => ({transform: computedTranslation(element), ...style});
    patch(host, {Left: 18});
    const element = host.elements.get('item2');
    assert.equal(host.geometryUpdates.translations.records.size, 1);
    const inline = element.style.transform;
    style = {...style, ...changed};
    reset();
    assert.equal(element.style.transform, inline, 'The exclusion cannot depend on an inline style mutation.');
    patch(host, {Left: 25});
    assert.equal(element.style.left, '25px');
    assert.equal(element.style.transform, '');
    assert.equal(host.geometryUpdates.translations.records.size, 0);
    assert.deepEqual(rendered, ['item2']);
    host.dispose();
  }
});

test('a CSS transform overriding inline composition falls back synchronously before reporting its updated geometry', () => {
  for (const transform of ['none', 'matrix(0, 1, -1, 0, 0, 0)']) {
    const {host, rendered, measured} = geometryHost(canvasScene(4));
    host.document.defaultView.getComputedStyle = () => ({transform});
    patch(host, {Left: 18, Top: 12});
    assert.equal(host.nodes.get('item2').properties.Left, 18);
    assert.equal(host.nodes.get('item2').properties.Top, 12);
    assert.equal(host.elements.get('item2').style.left, '18px');
    assert.equal(host.elements.get('item2').style.top, '12px');
    assert.equal(host.geometryUpdates.translations.records.size, 0);
    assert.deepEqual(rendered, ['item2']);
    assert.deepEqual(measured, ['item2']);
    host.dispose();
  }
});

test('a stylesheet taking transform ownership after an earlier retained move restores canonical layout', () => {
  const {host, rendered, reset} = geometryHost(canvasScene(4));
  let override = false;
  host.document.defaultView.getComputedStyle = element => ({
    transform: override ? 'matrix(0, 1, -1, 0, 0, 0)' : computedTranslation(element)
  });
  patch(host, {Left: 12});
  assert.equal(host.geometryUpdates.translations.records.size, 1);
  override = true;
  reset();
  patch(host, {Left: 18});
  assert.equal(host.geometryUpdates.translations.records.size, 0);
  assert.equal(host.elements.get('item2').style.left, '18px');
  assert.deepEqual(rendered, ['item2']);
  host.dispose();
});

test('geometry style, external scene and complete reload changes reset the retained layout origin', () => {
  const {host, rendered, reset} = geometryHost(canvasScene(4));
  const element = host.elements.get('item2');
  patch(host, {Left: 18});
  patch(host, {Margin: {Left: 3, Top: 2, Right: 1, Bottom: 0}});
  assert.equal(element.style.left, '18px');
  assert.equal(element.style.transform, '');
  assert.equal(host.geometryUpdates.translations.records.size, 0);
  patch(host, {Left: 20});
  assert.equal(element.style.transform, 'translate(2px, 0px)');
  host.apply({op: 'set', id: 'item2', property: 'Content', value: 'External source'});
  assert.equal(host.geometryUpdates.translations.records.size, 0);
  host.flush();
  assert.equal(element.style.left, '20px');
  assert.equal(element.style.transform, '');
  reset();
  patch(host, {Left: 22});
  assert.equal(element.style.transform, 'translate(2px, 0px)');
  assert.deepEqual(rendered, []);
  host.load(canvasScene(4));
  host.flush();
  assert.equal(host.geometryUpdates.translations.records.size, 0);
  assert.equal(element.style.left, '2px');
  assert.equal(element.style.transform, '');
  host.dispose();
});

test('real document property undo and redo restore both the authoritative scene and the same retained DOM element', () => {
  const document = new DesignDocument(createDesign('Canvas position history'));
  const environment = new DesignPreviewEnvironment();
  const {host, rendered, measured, reset} = geometryHost(designScene(document.value));
  const view = {document, host, resourceGallery: {render() {}}, resourceDocument: false,
    surface: {preview: environment}, buildPreviewScene: () => designScene(document.value), resizeArtboard() {}, drawAdorners() {}};
  const projection = new DesignerPreviewProjection(view);
  projection.update({kind: 'initialize'});
  reset();
  const baseline = document.serialize();
  const before = {...document.node('action').properties};
  const element = host.elements.get('action');
  const transform = element.style.transform;
  const incremental = [];
  const unsubscribe = document.subscribe(event => incremental.push(projection.update(event)));
  document.patchProperties({action: {Left: before.Left + 19.25, Top: before.Top - 7.5}}, {label: 'Move'});
  const moved = document.serialize();
  assert.equal(element.style.transform, 'translate(19.25px, -7.5px)');
  assert.equal(document.undoStack.length, 1);
  document.undo();
  assert.equal(document.serialize(), baseline);
  assert.equal(element.style.transform, transform);
  document.undo(true);
  assert.equal(document.serialize(), moved);
  assert.equal(element.style.transform, 'translate(19.25px, -7.5px)');
  assert.deepEqual(host.nodes.get('action').properties, designScene(document.value).nodes.find(node => node.id === 'action').properties);
  assert.equal(host.elements.get('action'), element);
  assert.deepEqual(incremental, [true, true, true]);
  assert.deepEqual(rendered, []);
  assert.deepEqual(measured, ['action', 'action', 'action']);
  unsubscribe();
  projection.dispose();
  host.dispose();
});
