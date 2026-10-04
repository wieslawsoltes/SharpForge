import test from 'node:test';
import assert from 'node:assert/strict';
import {RetainedSceneRenderer} from '../packages/rendering/src/controls/scene-renderer.js';
import {registerImageHostRenderer} from '../packages/rendering/src/controls/image-host.js';
import {ImageCache} from '../packages/rendering/src/media/images.js';
import {ResourceTable} from '../packages/rendering/src/resources/resource-table.js';
import {GpuDevice} from '../packages/rendering/src/webgpu/device.js';
import {createMockGpu} from './fixtures/rendering/mock-gpu.js';

function element(document, name = 'div') {
  const listeners = new Map();
  return {ownerDocument: document, tagName: name.toUpperCase(), style: {}, dataset: {}, children: [],
    setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; },
    prepend(child) { child.parentNode = this; this.children.unshift(child); },
    append(child) { child.parentNode = this; this.children.push(child); },
    remove() { this.removed = true; },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    dispatch(name) { return listeners.get(name)?.(); },
    getBoundingClientRect() { throw new Error('Retained rendering must use layout geometry'); }};
}

function scene() {
  const mock = createMockGpu(), document = mock.document, canvasElement = document.createElement.bind(document);
  document.createElement = name => name === 'canvas' ? canvasElement(name) : element(document, name);
  document.defaultView.devicePixelRatio = 2;
  const root = element(document), resources = new ResourceTable(), deviceService = new GpuDevice({gpu: mock.gpu});
  const listeners = new Set(), textService = {provider: {fontVersion: 0},
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { throw new Error('Borrowed text service cannot be disposed by the renderer'); }};
  const renderer = new RetainedSceneRenderer(root, {backend: 'canvas2d', resources, deviceService, textService,
    onError(error) { throw error; }});
  const node = {id: 'shape', type: 'Microsoft.UI.Xaml.Shapes.Rectangle', version: 1,
    properties: {Fill: '#ff4020', RadiusX: 3, RadiusY: 2}, collections: {}};
  const layout = {rect: {x: 0, y: 0, width: 20, height: 10}, renderSize: {width: 20, height: 10},
    worldTransform: [1, 0, 0, 1, 0, 0], clips: [{rect: [0, 0, 20, 10]}]};
  const host = {root, elements: new Map([[node.id, element(document)]]), nodes: new Map([[node.id, node]]),
    states: new Map(), services: {}, invalidations: [], schedules: 0,
    invalidate(id, phase) { this.invalidations.push({id, phase}); }, schedule() { this.schedules++; },
    getLayout: () => layout};
  return {mock, document, renderer, node, layout, host, resources, deviceService, listeners};
}

test('Retained scene placement reuses local content, suppresses native input painting and releases only owned surfaces', async () => {
  const subject = scene(), {renderer, node, layout, host, resources, deviceService, listeners} = subject;
  try {
    assert.equal(renderer.collect(host, node, layout), true);
    renderer.renderFrame(); await renderer.settled();
    const entry = renderer.entries.get(node.id), content = entry.list, firstPlacement = entry.renderList;
    assert.equal(entry.surface.backend, 'canvas2d');
    assert.equal(entry.surface.canvas['aria-hidden'], 'true');
    assert.deepEqual([entry.surface.canvas.width, entry.surface.canvas.height], [40, 20]);
    assert.equal(resources.liveCount, 1);
    layout.worldTransform = [1, 0, 0, 1, -4, 0];
    assert.equal(renderer.collect(host, node, layout), true);
    renderer.renderFrame();
    assert.equal(entry.list, content);
    assert.notEqual(entry.renderList, firstPlacement);
    assert.equal(resources.resolve(entry.placement.handle, 'layer').displayList, content);
    host.elements.set('input', element(subject.document, 'input'));
    const input = {id: 'input', type: 'Microsoft.UI.Xaml.Controls.TextBox', properties: {Text: 'editable'}};
    assert.equal(renderer.collect(host, input, layout), false);
    assert.match(host.elements.get('input').dataset.renderFallback, /Native text\/input/);
    assert.equal(renderer.entries.has('input'), false);
    assert.equal(renderer.collect(host, {...node, type: 'UnsupportedVisual'}, layout), false);
    const canvas = entry.surface.canvas;
    renderer.setBackend('webgpu');
    assert.equal(canvas.removed, true);
    assert.equal(resources.liveCount, 0);
    assert.equal(deviceService.closed, false);
    assert.equal(listeners.size, 1);
    renderer.dispose(); renderer.dispose();
    assert.equal(listeners.size, 0);
    assert.equal(resources.closed, false);
    assert.equal(deviceService.closed, false);
    assert.equal(renderer.collect(host, node, layout), false);
  } finally { renderer.dispose(); await resources.dispose(); await deviceService.dispose(); }
});

test('Image host generation changes discard late decoded resources and disposal removes live callbacks', async () => {
  const subject = scene(), {renderer, document, resources, deviceService} = subject;
  const pending = [], bitmaps = [];
  renderer.imageCache = new ImageCache({decode: image => new Promise(resolve => pending.push({source: image.src, resolve}))});
  let descriptor;
  const legacy = {render(context, node, image) { image.src = node.properties.Source; image.alt = 'Loaded image'; }};
  registerImageHostRenderer({resolve: () => legacy, register(type, value) { descriptor = value; }}, renderer);
  const state = {}, events = [], invalidations = [];
  const context = {document, getState: () => state, resolve() {},
    invalidate(id, phase) { invalidations.push({id, phase}); }, emit(node, name) { events.push(name); }};
  const node = {id: 'image', properties: {Source: 'first.png'}}, owner = descriptor.create(context);
  const finish = (index, width) => {
    const bitmap = {width, height: 4, closes: 0, close() { this.closes++; }};
    bitmaps.push(bitmap); pending[index].resolve(bitmap);
  };
  try {
    descriptor.render(context, node, owner);
    const first = state.nativeImage.dispatch('load');
    node.properties.Source = 'second.png'; descriptor.render(context, node, owner);
    const second = state.nativeImage.dispatch('load');
    assert.deepEqual(pending.map(item => item.source), ['first.png', 'second.png']);
    finish(1, 8); await second;
    const current = state.imageHandle;
    finish(0, 6); await first;
    assert.equal(state.imageHandle, current);
    assert.equal(resources.resolve(current, 'image').width, 8);
    assert.deepEqual(events, ['ImageOpened']);
    assert.deepEqual(invalidations, [{id: node.id, phase: 'measure'}]);
    assert.deepEqual([node.properties.NaturalWidth, node.properties.NaturalHeight], [8, 4]);
    node.properties.Source = 'third.png'; descriptor.render(context, node, owner);
    const third = state.nativeImage.dispatch('load');
    state.dispose(); finish(2, 10); await third;
    assert.equal(resources.liveCount, 0);
    assert.equal(state.imageHandle, null);
    assert.equal(state.nativeImage.dispatch('load'), undefined);
    assert.deepEqual(events, ['ImageOpened']);
    renderer.dispose();
    assert.deepEqual(bitmaps.map(bitmap => bitmap.closes), [1, 1, 1]);
  } finally { renderer.dispose(); await resources.dispose(); await deviceService.dispose(); }
});
