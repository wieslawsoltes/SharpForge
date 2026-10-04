import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingContext} from '../packages/rendering/src/drawing/context.js';
import {ResourceTable} from '../packages/rendering/src/resources/resource-table.js';
import {GpuDevice} from '../packages/rendering/src/webgpu/device.js';
import {WebGpuBackend} from '../packages/rendering/src/backends/webgpu.js';
import {createVectorPipelines} from '../packages/rendering/src/webgpu/pipelines.js';
import {createMockGpu} from './fixtures/rendering/mock-gpu.js';

async function fixture(options = {}, gpuOptions = {}) {
  const mock = createMockGpu(gpuOptions);
  const service = new GpuDevice({gpu: mock.gpu});
  const canvas = mock.createCanvas();
  const backend = new WebGpuBackend(canvas, service, options);
  await backend.ready;
  const resources = new ResourceTable({session: 'retention-fixture'});
  return {mock, service, canvas, backend, resources, async dispose() {
    backend.dispose();
    for (const device of mock.devices) device.queue.complete();
    await service.retirement.drain();
    await resources.dispose();
    await service.dispose();
  }};
}

function rectangles(count, brush, {changed = -1, version = 1} = {}) {
  const context = new DrawingContext({elementId: 'instances', version});
  for (let index = 0; index < count; index++) {
    context.DrawRoundedRectangle([index % 100 * 3 + (index === changed ? 1 : 0), Math.floor(index / 100) * 3, 2, 2], 0.5, brush);
  }
  return context.finish([0, 0, 300, Math.ceil(count / 100) * 3]);
}

test('retained analytic plans upload one changed instance and keep allocations stable across unchanged frames', async () => {
  const subject = await fixture();
  const {backend, resources} = subject;
  const brush = resources.register('brush', {kind: 'solid', color: [1, 0, 0, 1], opacity: 1});
  const first = rectangles(10000, brush);
  const firstMetrics = backend.render(first, resources, {width: 320, height: 320, dpr: 1});
  const plan = backend.plan, device = backend.device, allocationCount = device.buffers.length;
  assert.equal(plan.root.commands.length, 1);
  assert.equal(plan.root.commands[0].mesh.kind, 'analytic');
  assert.equal(plan.root.commands[0].mesh.count, 10000);
  assert.equal(firstMetrics.drawCalls, 2);
  assert.ok(firstMetrics.uploadedBytes >= 10000 * 128);
  for (let frame = 0; frame < 5; frame++) {
    const result = backend.render(first, resources, {width: 320, height: 320, dpr: 1});
    assert.equal(result.uploadedBytes, 0);
    assert.equal(result.changedInstances, 0);
    assert.equal(backend.plan, plan);
  }
  device.queue.writes.length = 0;
  const second = rectangles(10000, brush, {changed: 4321, version: 2});
  const update = backend.render(second, resources, {width: 320, height: 320, dpr: 1});
  assert.equal(backend.plan, plan);
  assert.equal(device.buffers.length, allocationCount);
  assert.equal(update.changedInstances, 1);
  assert.equal(update.uploadedBytes, 128);
  assert.equal(update.ranges, 1);
  assert.deepEqual(device.queue.writes.map(write => [write.offset, write.bytes.length]), [[4321 * 128, 128]]);
  resources.update(brush, {kind: 'solid', color: [0, 1, 0, 1], opacity: 1});
  const color = backend.render(second, resources, {width: 320, height: 320, dpr: 1});
  assert.equal(color.changedInstances, 10000);
  assert.equal(color.ranges, 1);
  assert.equal(color.uploadedBytes, 10000 * 128);
  assert.equal(backend.plan, plan);
  const differentTopology = new DrawingContext().DrawEllipse([0, 0, 20, 20], brush).finish();
  backend.render(differentTopology, resources, {width: 320, height: 320, dpr: 1});
  assert.notEqual(backend.plan, plan);
  await subject.dispose();
  assert.ok(device.buffers.every(buffer => buffer.destroyCount === 1));
  assert.ok(device.textures.every(texture => texture.destroyCount === 1));
});

test('local GPU layer rasters survive placement changes and remain alive until their last submission completes', async () => {
  const subject = await fixture({}, {autoComplete: false});
  const {backend, resources, service} = subject;
  const brush = resources.register('brush', '#ff0000');
  const child = new DrawingContext({elementId: 'child', version: 1}).DrawRectangle([4, 6, 20, 10], brush).finish([4, 6, 20, 10]);
  const layer = resources.register('layer', {cacheKey: 'child', contentVersion: 1, displayList: child});
  const parent = offset => new DrawingContext().DrawLayer(layer, {transform: [1, 0, 0, 1, offset, 0], opacity: 0.5}).finish();
  const initial = backend.render(parent(0), resources, {width: 100, height: 100, dpr: 2});
  const raster = backend.plan.root.commands[0].raster;
  assert.equal(initial.layerRasterizations, 1);
  assert.deepEqual([raster.image.resource.width, raster.image.resource.height], [40, 20]);
  assert.deepEqual([...raster.facade.uniformData].slice(0, 2), [20, 10]);
  assert.notEqual(raster.facade.uniform, backend.uniform);
  const moved = backend.render(parent(30), resources, {width: 100, height: 100, dpr: 2});
  assert.equal(backend.plan.root.commands[0].raster, raster);
  assert.equal(moved.layerRasterizations, 0);
  assert.equal(moved.layerCacheHits, 1);
  resources.update(brush, '#0000ff');
  assert.equal(raster.cached, false);
  assert.equal(raster.closed, false);
  const refreshed = backend.render(parent(30), resources, {width: 100, height: 100, dpr: 2});
  assert.equal(refreshed.layerRasterizations, 1);
  assert.notEqual(backend.plan.root.commands[0].raster, raster);
  assert.equal(raster.closed, true);
  assert.equal(raster.facade.uniform.destroyed, false);
  backend.device.queue.complete();
  await service.retirement.drain();
  assert.equal(raster.facade.uniform.destroyed, true);
  await subject.dispose();
});

test('GPU damage erases only preserved pixels and clear obeys the current stencil clip', async () => {
  const subject = await fixture();
  const {backend, resources} = subject;
  const list = new DrawingContext().PushClip({kind: 'rectangle', rect: [5, 5, 20, 20]})
    .DrawRectangle([0, 0, 40, 40], '#ff0000').Clear([0, 0, 0, 0]).Pop().finish();
  backend.render(list, resources, {width: 50, height: 50, dpr: 2, clear: false, damage: [4, 5, 6, 7]});
  let frame = backend.device.queue.submissions.at(-1).commands[0];
  assert.equal(frame.passes[0].descriptor.colorAttachments[0].loadOp, 'clear');
  assert.equal(frame.passes[0].commands.some(command => command.kind === 'scissor'), false);
  backend.render(list, resources, {width: 50, height: 50, dpr: 2, clear: false, damage: [4, 5, 6, 7]});
  frame = backend.device.queue.submissions.at(-1).commands[0];
  const root = frame.passes[0];
  assert.equal(root.descriptor.colorAttachments[0].loadOp, 'load');
  assert.deepEqual(root.commands.find(command => command.kind === 'scissor').value, [8, 10, 12, 14]);
  assert.equal(root.commands.find(command => command.kind === 'draw').pipeline, backend.pipelines.replace);
  assert.ok(root.commands.some(command => command.kind === 'draw' && command.pipeline === backend.pipelines.clear));
  assert.equal(backend.pipelines.replace.descriptor.depthStencil.stencilFront.compare, 'always');
  assert.equal(backend.pipelines.clear.descriptor.depthStencil.stencilFront.compare, 'equal');
  assert.equal(backend.pipelines.clear.descriptor.fragment.targets[0].blend, undefined);
  backend.render(list, resources, {width: 60, height: 50, dpr: 2, clear: false, damage: [4, 5, 6, 7]});
  frame = backend.device.queue.submissions.at(-1).commands[0];
  assert.equal(frame.passes[0].descriptor.colorAttachments[0].loadOp, 'clear');
  await subject.dispose();
});

test('forced operation fallback retains painter order and truthful fallback metadata on reused plans', async () => {
  const fallbacks = [];
  const subject = await fixture({disabledOperations: ['vector'], onFallback: value => fallbacks.push(value)});
  const {backend, resources, mock} = subject;
  const list = new DrawingContext().DrawRectangle([0, 0, 10, 10], '#ff0000').DrawRectangle([5, 5, 10, 10], '#0000ff').finish();
  const first = backend.render(list, resources, {width: 20, height: 20, dpr: 1});
  assert.equal(backend.plan.root.commands.length, 2);
  assert.ok(backend.plan.root.commands.every(command => command.kind === 'draw' && command.mesh.kind !== 'analytic'));
  assert.equal(first.fallbacks.length, 2);
  assert.ok(first.fallbacks.every(value => value.operation === 'vector' && value.backend === 'canvas2d'));
  const second = backend.render(list, resources, {width: 20, height: 20, dpr: 1});
  assert.deepEqual(second.fallbacks, first.fallbacks);
  assert.equal(fallbacks.length, 2);
  assert.ok(mock.document.canvases.some(canvas => canvas.calls.some(call => call.name === 'fill')));
  await subject.dispose();
  assert.equal(subject.canvas.gpuContext.unconfigured, true);
});

test('device-owned pipelines distinguish target formats and reject failed shader compilation without caching failure', async () => {
  const mock = createMockGpu(), service = new GpuDevice({gpu: mock.gpu});
  const device = await service.acquire();
  const cache = service.pipelineCaches.vector;
  const options = {cache, format: 'rgba8unorm', presentationFormat: 'bgra8unorm', sampleCount: 4};
  const first = await createVectorPipelines(device, options);
  assert.equal(await createVectorPipelines(device, options), first);
  const linear = await createVectorPipelines(device, {...options, format: 'rgba16float'});
  assert.notEqual(linear, first);
  assert.equal(linear.draw.descriptor.fragment.targets[0].format, 'rgba16float');
  assert.equal(linear.present.descriptor.fragment.targets[0].format, 'bgra8unorm');
  assert.equal(linear.present.descriptor.multisample.count, 1);
  const failureOptions = {compilationErrors: [{type: 'error', message: 'injected compile failure'}]};
  const failure = createMockGpu(failureOptions);
  const brokenDevice = await failure.adapter.requestDevice();
  const brokenCache = new Map();
  await assert.rejects(createVectorPipelines(brokenDevice, {cache: brokenCache}), /injected compile failure/);
  failureOptions.compilationErrors = [];
  await createVectorPipelines(brokenDevice, {cache: brokenCache});
  const oldCaches = service.pipelineCaches;
  device.lose();
  await Promise.resolve();
  const recovered = await service.acquire();
  assert.notEqual(recovered, device);
  assert.notEqual(service.pipelineCaches, oldCaches);
  assert.equal(oldCaches.vector.size, 0);
  await service.dispose();
  brokenDevice.destroy();
});

test('failed and recursive retained plans release temporary buffers and local uniforms', async () => {
  const subject = await fixture();
  const {backend, resources, service} = subject;
  const data = {cacheKey: 'cycle', contentVersion: 1, bounds: [0, 0, 4, 4], displayList: {commands: []}};
  const handle = resources.register('layer', data);
  data.displayList.commands.push({op: 23, layer: handle, options: {}});
  const list = new DrawingContext().DrawLayer(handle).finish();
  assert.throws(() => backend.render(list, resources, {width: 8, height: 8, dpr: 1, layerDepth: 64}), /nesting budget/);
  assert.equal(backend.plan, null);
  await service.retirement.drain();
  const localUniforms = backend.device.buffers.filter(buffer => buffer.descriptor.label === 'SharpForge cached layer viewport');
  assert.ok(localUniforms.length < 4);
  assert.ok(localUniforms.every(buffer => buffer.destroyed));
  await subject.dispose();
});
