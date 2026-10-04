import test from 'node:test';
import assert from 'node:assert/strict';
import {portableText, pngHeaderRecorder} from './fixtures/rendering/portable-text.js';
import {createMockGpu} from './fixtures/rendering/mock-gpu.js';
import {TextLayoutService} from '../packages/rendering/src/text/layout.js';
import {DrawingContext} from '../packages/rendering/src/drawing/context.js';
import {ResourceTable} from '../packages/rendering/src/resources/resource-table.js';
import {GpuDevice} from '../packages/rendering/src/webgpu/device.js';
import {WebGpuBackend} from '../packages/rendering/src/backends/webgpu.js';

test('real shaped emoji retries a pending image through unchanged retained lists and local GPU layer caches', async () => {
  const mock = createMockGpu(), resources = new ResourceTable(), service = new GpuDevice({gpu: mock.gpu});
  let release;
  const decoded = new Promise(resolve => { release = resolve; });
  const provider = await portableText({createCanvas: (width, height) => {
    const canvas = mock.createCanvas(); canvas.width = width; canvas.height = height; return canvas;
  }, decodeImage: async bytes => { await decoded; return pngHeaderRecorder(bytes); }});
  const textService = new TextLayoutService(provider), backend = new WebGpuBackend(mock.createCanvas(), service, {textService});
  await backend.ready;
  try {
    const run = provider.layout('👩‍💻', {fontSize: 32});
    assert.equal(run.glyphAccess, 'numeric-glyphs');
    const content = new DrawingContext({elementId: 'emoji-content', version: 1}).DrawGlyphRun(run, [0, 0], '#000000').finish([0, 0, 64, 64]);
    const list = new DrawingContext().DrawLayer({displayList: content, bounds: [0, 0, 64, 64], cacheKey: 'emoji', contentVersion: 1}).finish();
    backend.render(list, resources, {width: 64, height: 64, dpr: 1});
    const before = backend.plan;
    const oldLayer = before.root.commands.find(command => command.kind === 'layer');
    assert.ok(oldLayer?.raster);
    assert.equal(oldLayer.target.commands.some(command => command.mesh?.kind === 'glyph'), false);
    release();
    await provider.rasterizer.prepare(run);
    assert.ok(provider.fontVersion > 0);
    backend.render(list, resources, {width: 64, height: 64, dpr: 1});
    assert.notEqual(backend.plan, before);
    const layer = backend.plan.root.commands.find(command => command.kind === 'layer');
    assert.notEqual(layer.raster, oldLayer.raster);
    const glyph = layer.target.commands.find(command => command.mesh?.kind === 'glyph');
    assert.ok(glyph.mesh.count > 0);
    assert.equal(glyph.mesh.data[18], 1, 'the retried glyph retains intrinsic color');
    const current = backend.plan;
    backend.render(list, resources, {width: 64, height: 64, dpr: 1});
    assert.equal(backend.plan, current);
  } finally {
    release(); backend.dispose(); textService.dispose();
    await service.retirement.drain(); await resources.dispose(); await service.dispose();
  }
});
