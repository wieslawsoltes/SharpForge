import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingContext} from '../packages/rendering/src/drawing/context.js';
import {ResourceTable} from '../packages/rendering/src/resources/resource-table.js';
import {GpuDevice} from '../packages/rendering/src/webgpu/device.js';
import {TextureCache} from '../packages/rendering/src/webgpu/texture-cache.js';
import {MeshBuilder} from '../packages/rendering/src/webgpu/mesh-builder.js';
import {analyticInstance} from '../packages/rendering/src/webgpu/analytic-instances.js';
import {trianglesContain} from '../packages/rendering/src/geometry/tessellation.js';
import {createMockGpu} from './fixtures/rendering/mock-gpu.js';

test('GPU geometry keeps hollow strokes and world placement while analytic instances retain elliptical radii', async () => {
  const mock = createMockGpu(), service = new GpuDevice({gpu: mock.gpu}), resources = new ResourceTable();
  await service.acquire();
  const textures = new TextureCache(service), meshes = new MeshBuilder(textures);
  try {
    const command = new DrawingContext().DrawRoundedRectangle([0, 0, 20, 10], [3, 2], null,
      {brush: '#ff0000', width: 2}).finish().commands[0];
    const transform = [2, 0, 0, 2, 5, 7], built = meshes.build(command, transform, resources, {dpr: 1});
    assert.equal(built.length, 1);
    const triangles = [];
    for (let index = 0; index < built[0].data.length; index += 12) triangles.push(...built[0].data.slice(index, index + 2));
    assert.equal(trianglesContain(triangles, [25, 17]), false);
    assert.equal(trianglesContain(triangles, [5, 17]), true);
    assert.equal(built[0].count % 3, 0);
    const instance = analyticInstance(command, transform, resources, {dpr: 2}, built[0].texture);
    assert.equal(instance.kind, 'analytic'); assert.equal(instance.count, 1);
    assert.deepEqual([...instance.data.slice(4, 12)], [3, 3, 3, 3, 2, 2, 2, 2]);
    assert.equal(instance.data[15], 0); assert.equal(instance.data[19], 1);
    const dashed = {...command, pen: {...command.pen, dash: [2, 2]}};
    assert.equal(analyticInstance(dashed, transform, resources, {dpr: 1}, built[0].texture), null);
    assert.ok(meshes.build(dashed, transform, resources, {dpr: 1})[0].count > 0);
  } finally {
    meshes.dispose(); textures.dispose(); await service.retirement.drain(); await resources.dispose(); await service.dispose();
  }
  assert.ok(mock.devices[0].textures.every(texture => texture.destroyCount === 1));
});
