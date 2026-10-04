import test from 'node:test';
import assert from 'node:assert/strict';
import {GpuDevice} from '../packages/rendering/src/webgpu/device.js';
import {BufferPool, TexturePool} from '../packages/rendering/src/webgpu/pools.js';
import {EffectPipeline} from '../packages/rendering/src/webgpu/effect-pipeline.js';
import {probeRenderingCapabilities, selectOperationBackend} from '../packages/rendering/src/backends/negotiation.js';
import {createMockGpu} from './fixtures/rendering/mock-gpu.js';

test('GPU effects retain app-owned pipelines and scale Gaussian DIP radius before submitting owned targets', async () => {
  const mock = createMockGpu(), service = new GpuDevice({gpu: mock.gpu});
  const device = await service.acquire(), bufferPool = new BufferPool(service), texturePool = new TexturePool(service);
  const backend = {service, device, bufferPool, texturePool, targetFormat: 'rgba8unorm', pixelWidth: 8, pixelHeight: 8,
    colorSpace: 'srgb', sampler: device.createSampler({})};
  const source = texturePool.acquire({size: [8, 8], format: 'rgba8unorm', usage: 4 | 16});
  const plan = {options: {dpr: 2}, root: {image: source}, buffers: [], effectTextures: []};
  let ticket;
  try {
    const effects = new EffectPipeline(backend); await effects.ready;
    const another = new EffectPipeline(backend); await another.ready;
    assert.equal(another.pipeline, effects.pipeline);
    const program = effects.compile({type: 'GaussianBlur', blurAmount: 3, sources: [{type: 'Source', name: 'input'}]},
      {input: source}, plan);
    assert.equal(program.stages.length, 2);
    assert.equal(program.output, program.stages[1].target);
    const parameters = device.queue.writes.map(write => new Float32Array(write.bytes.slice().buffer));
    assert.deepEqual(parameters.map(value => [...value.slice(0, 4)]), [[8, 8, 0, 6], [8, 8, 1, 6]]);
    const encoder = device.createCommandEncoder(), metrics = {drawCalls: 0};
    effects.render(encoder, program, metrics);
    assert.equal(metrics.drawCalls, 2);
    ticket = service.submit([encoder.finish()]);
    assert.equal(device.queue.submissions.length, 1);
    const targets = texturePool.live.size;
    assert.throws(() => effects.compile({type: 'Source', name: 'missing'}, {}, plan), error => error.code === 'SFRENDER103');
    assert.equal(texturePool.live.size, targets);
  } finally {
    await Promise.all([...plan.buffers.map(lease => bufferPool.release(lease, ticket)),
      ...[source, ...plan.effectTextures].map(lease => texturePool.release(lease, ticket))]);
    await bufferPool.dispose(); await texturePool.dispose(); await service.dispose();
  }
  assert.ok(device.buffers.every(buffer => buffer.destroyCount === 1));
  assert.ok(device.textures.every(texture => texture.destroyCount === 1));
});

test('operation negotiation uses only the acquired app device and reports an explicit per-operation fallback', async () => {
  const mock = createMockGpu(), service = new GpuDevice({gpu: mock.gpu});
  await service.acquire();
  try {
    const capabilities = probeRenderingCapabilities({deviceService: service, canvas: mock.createCanvas(), disabledOperations: ['vector']});
    assert.equal(mock.requests.length, 1); assert.equal(mock.devices.length, 1);
    assert.equal(selectOperationBackend('text', capabilities).backend, 'webgpu');
    const fallback = selectOperationBackend('vector', capabilities);
    assert.equal(fallback.backend, 'canvas2d'); assert.match(fallback.reason, /vector/);
    assert.throws(() => selectOperationBackend('unknown', capabilities), error => error.code === 'SFRENDER106');
  } finally { await service.dispose(); }
});
