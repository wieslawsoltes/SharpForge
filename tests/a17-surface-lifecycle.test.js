import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingContext} from '../packages/rendering/src/drawing/context.js';
import {ResourceTable} from '../packages/rendering/src/resources/resource-table.js';
import {GpuDevice} from '../packages/rendering/src/webgpu/device.js';
import {RenderSurface} from '../packages/rendering/src/backends/surface.js';
import {DirtyRegions} from '../packages/rendering/src/dirty-regions.js';
import {createMockGpu} from './fixtures/rendering/mock-gpu.js';

test('One thousand surfaces and backend switches release buffers/textures while preserving the injected app device', async () => {
  const mock = createMockGpu();
  const service = new GpuDevice({gpu: mock.gpu});
  const resources = new ResourceTable();
  const context = new DrawingContext();
  context.DrawRectangle([0, 0, 8, 8], '#ff0000');
  const list = context.finish([0, 0, 8, 8]);
  for (let index = 0; index < 1000; index++) {
    const container = {ownerDocument: mock.document, prepend() {}};
    const surface = new RenderSurface(container, {gpu: mock.gpu, deviceService: service, resources,
      onError(error) { throw error; }});
    await surface.ready;
    assert.equal(surface.backend, 'webgpu');
    surface.updateDisplayList(list, resources, 8, 8, 1);
    if (index % 100 === 0) {
      await surface.setBackend('canvas2d');
      assert.equal(surface.backend, 'canvas2d');
      await surface.setBackend('webgpu');
      assert.equal(surface.backend, 'webgpu');
    }
    surface.dispose();
    surface.dispose();
    assert.equal(service.closed, false);
  }
  await service.retirement.drain();
  assert.equal(mock.devices.length, 1);
  const device = mock.devices[0];
  assert.equal(device.buffers.every(buffer => buffer.destroyCount === 1), true);
  assert.equal(device.textures.every(texture => texture.destroyCount === 1), true);
  assert.equal(mock.document.canvases.every(canvas => canvas.removed), true);
  await resources.dispose();
  await service.dispose();
});

test('A moved 100 by 20 DIP strip damages below five percent of a 1080p surface', () => {
  const damage = new DirtyRegions({width: 1920, height: 1080});
  damage.consume({preservedContents: true});
  damage.moved('animated-strip', [20, 20, 100, 20], [30, 20, 100, 20]);
  const result = damage.consume({preservedContents: true});
  assert.equal(result.full, false);
  assert.ok(result.damagedPixels < 1920 * 1080 * 0.05);
});
