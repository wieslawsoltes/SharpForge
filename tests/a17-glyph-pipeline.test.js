import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingContext} from '../packages/rendering/src/drawing/context.js';
import {ResourceTable} from '../packages/rendering/src/resources/resource-table.js';
import {GpuDevice} from '../packages/rendering/src/webgpu/device.js';
import {WebGpuBackend} from '../packages/rendering/src/backends/webgpu.js';
import {glyphInstanceFloats} from '../packages/rendering/src/webgpu/glyph-shader.js';
import {createMockGpu} from './fixtures/rendering/mock-gpu.js';

async function fixture({blendColorSpace = 'srgb'} = {}) {
  const mock = createMockGpu(), calls = [];
  const service = new GpuDevice({gpu: mock.gpu});
  const provider = {rasterizeGlyph(glyph, options) {
    calls.push({glyph, options});
    const width = Math.ceil(glyph.fontSize * options.dpr / 2), height = Math.ceil(glyph.fontSize * options.dpr);
    const source = mock.document.createElement('canvas');
    source.width = width;
    source.height = height;
    return {source, width, height, logicalBounds: {x: -options.subpixelX / options.dpr,
      y: -glyph.fontSize - options.subpixelY / options.dpr, width: width / options.dpr, height: height / options.dpr},
      colorGlyph: glyph.glyphId === 2, alphaMode: 'premultiplied', colorSpace: 'srgb'};
  }};
  const textService = {provider, rasterize() { throw new Error('Numeric glyphs must not use whole-run rasterization'); }};
  const backend = new WebGpuBackend(mock.createCanvas(), service, {textService, blendColorSpace});
  await backend.ready;
  const resources = new ResourceTable();
  return {mock, service, backend, resources, calls, async dispose() {
    backend.dispose();
    await service.retirement.drain();
    await resources.dispose();
    await service.dispose();
  }};
}

function glyph(glyphId, x, fontSize = 16) {
  return {glyphId, fontId: 'fixture-font-v1', fontSize, x, y: fontSize, xOffset: 99, yOffset: -99, cluster: 0, start: 0, end: 1};
}

test('Numeric runs batch one instance per glyph, preserve intrinsic color and render decorations in order', async () => {
  const subject = await fixture();
  const {backend, resources, calls} = subject;
  const run = resources.register('glyphRun', {glyphs: [glyph(1, 0.25), glyph(1, 10.25), glyph(2, 20.25)],
    decorations: [{rect: [0, 18, 30, 1]}, {rect: [0, 8, 30, 1], foreground: '#ff0000'}]});
  const list = new DrawingContext().DrawGlyphRun(run, [10, 20], '#0080ff').finish([0, 0, 100, 60]);
  const metrics = backend.render(list, resources, {width: 100, height: 60, dpr: 1});
  assert.equal(metrics.drawCalls, 3);
  const meshes = backend.plan.root.commands.map(command => command.mesh);
  assert.deepEqual(meshes.map(mesh => mesh.kind), ['glyph', 'vector']);
  assert.equal(meshes[0].count, 3);
  assert.equal(meshes[0].data.length, 3 * glyphInstanceFloats);
  assert.equal(calls.length, 2);
  assert.deepEqual([...meshes[0].data.slice(0, 4)], [10, 20, 8, 16]);
  assert.equal(meshes[0].data[18], 0);
  assert.equal(meshes[0].data[2 * glyphInstanceFloats + 18], 1);
  const pipeline = backend.device.pipelines.find(entry => entry.descriptor.label === 'SharpForge glyph').descriptor;
  assert.equal(pipeline.vertex.buffers[0].stepMode, 'instance');
  assert.equal(pipeline.vertex.buffers[0].arrayStride, 80);
  assert.equal(pipeline.fragment.targets[0].blend.color.srcFactor, 'one');
  assert.equal(backend.meshes.atlas.pages[0].pins, 1);
  await subject.dispose();
  assert.equal(backend.meshes.atlas.bytes, 0);
});

test('Steady numeric text frames reuse atlas uploads and GPU instance buffers; new glyphs append only dirty shelves', async () => {
  const subject = await fixture();
  const {backend, resources} = subject;
  const run = resources.register('glyphRun', {glyphs: [glyph(1, 0), glyph(1, 10)]});
  const list = new DrawingContext().DrawGlyphRun(run, [0, 0], '#000000').finish([0, 0, 100, 30]);
  backend.render(list, resources, {width: 100, height: 30, dpr: 1});
  const plan = backend.plan, device = backend.device;
  const buffers = device.buffers.length, writes = device.queue.writes.length, textureWrites = device.queue.textureWrites.length;
  for (let frame = 0; frame < 10; frame++) {
    backend.render(list, resources, {width: 100, height: 30, dpr: 1});
    assert.equal(backend.plan, plan);
    assert.equal(device.buffers.length, buffers);
    assert.equal(device.queue.writes.length, writes);
    assert.equal(device.queue.textureWrites.length, textureWrites);
  }
  resources.update(run, {glyphs: [glyph(1, 0), glyph(2, 10)]});
  backend.render(list, resources, {width: 100, height: 30, dpr: 1});
  const upload = device.queue.textureWrites.at(-1);
  assert.ok(upload.size[0] < backend.meshes.atlas.size);
  assert.ok(upload.size[1] < backend.meshes.atlas.size);
  assert.deepEqual(upload.source.origin, upload.destination.origin);
  assert.equal(subject.calls.length, 2);
  await subject.dispose();
  assert.equal(device.buffers.every(buffer => buffer.destroyCount === 1), true);
  assert.equal(device.textures.every(texture => texture.destroyCount === 1), true);
});

test('The numeric glyph path supports 10 through 72 DIP sizes with linear working-space targets', async () => {
  const subject = await fixture({blendColorSpace: 'linear'});
  const {backend, resources} = subject;
  for (const fontSize of [10, 12, 16, 24, 48, 72]) {
    const run = resources.register('glyphRun', {glyphs: [glyph(1, 0, fontSize)]});
    const list = new DrawingContext().DrawGlyphRun(run, [0, 0], '#808080').finish([0, 0, 100, 100]);
    const metrics = backend.render(list, resources, {width: 100, height: 100, dpr: 2});
    const mesh = backend.plan.root.commands[0].mesh;
    assert.equal(mesh.kind, 'glyph');
    assert.equal(mesh.data[3], fontSize);
    assert.equal(metrics.targetFormat, 'rgba16float');
    assert.equal(backend.uniformData[2], 1);
    await resources.release(run);
  }
  await subject.dispose();
});

test('Invalid glyph origins fail explicitly, and non-solid runs retain the complete-run raster fallback', async () => {
  const subject = await fixture();
  const {backend, resources} = subject;
  const invalid = resources.register('glyphRun', {glyphs: [glyph(1, NaN)]});
  const list = new DrawingContext().DrawGlyphRun(invalid, [0, 0], '#000000').finish();
  assert.throws(() => backend.render(list, resources, {width: 50, height: 30, dpr: 1}), error => error.code === 'SFRENDER133');
  assert.equal(backend.meshes.atlas.bytes, 0);
  const valid = resources.register('glyphRun', {glyphs: [glyph(1, 0)]});
  const gradient = {kind: 'linear', start: [0, 0], end: [1, 0], stops: [{offset: 0, color: '#000000'}, {offset: 1, color: '#ffffff'}]};
  const fallback = new DrawingContext().DrawGlyphRun(valid, [0, 0], gradient).finish();
  assert.throws(() => backend.render(fallback, resources, {width: 50, height: 30, dpr: 1}), /whole-run rasterization/);
  await subject.dispose();
});
