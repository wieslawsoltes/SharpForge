import test from 'node:test';
import assert from 'node:assert/strict';
import {GpuDevice} from '../packages/rendering/src/webgpu/device.js';
import {BufferPool, TexturePool} from '../packages/rendering/src/webgpu/pools.js';

function gpuFixture() {
  const devices = [];
  let allocations = 0;
  let destructions = 0;
  const gpu = {requestAdapter: async () => ({requestDevice: async () => {
    let lose;
    const device = {lost: new Promise(resolve => { lose = resolve; }),
      queue: {submit() {}, onSubmittedWorkDone: () => Promise.resolve()},
      createBuffer: () => { allocations++; return {destroy: () => destructions++}; },
      createTexture: () => { allocations++; return {destroy: () => destructions++}; },
      destroy() { lose({reason: 'destroyed'}); }, lose: () => lose({reason: 'unknown'})};
    devices.push(device);
    return device;
  }})};
  return {gpu, devices, allocations: () => allocations, destructions: () => destructions};
}

test('Ten surfaces acquire one application device and loss rebuilds shared state', async () => {
  const fixture = gpuFixture();
  const service = new GpuDevice({gpu: fixture.gpu});
  const rebuilt = [];
  service.addRebuilder('atlas', context => rebuilt.push(context.epoch));
  const devices = await Promise.all(Array.from({length: 10}, () => service.acquire()));
  assert(devices.every(device => device === devices[0]));
  assert.equal(fixture.devices.length, 1);
  const ready = new Promise(resolve => service.subscribe(event => { if (event.state === 'ready' && event.epoch > 1) resolve(); }));
  devices[0].lose();
  await ready;
  assert.equal(fixture.devices.length, 2);
  assert.deepEqual(rebuilt, [1, 2]);
  await service.dispose();
  await service.dispose();
  await assert.rejects(service.acquire());
});

test('Pools never recycle or destroy resources referenced by pending submissions', async () => {
  const fixture = gpuFixture();
  const service = new GpuDevice({gpu: fixture.gpu});
  await service.acquire();
  const pool = new BufferPool(service, {maxBytes: 1024});
  const first = pool.acquire(40, 8);
  let complete;
  const ticket = {id: 1, done: new Promise(resolve => { complete = resolve; })};
  const release = pool.release(first, ticket);
  const second = pool.acquire(40, 8);
  assert.notEqual(first.resource, second.resource);
  assert.equal(fixture.destructions(), 0);
  complete();
  await release;
  const third = pool.acquire(40, 8);
  assert.equal(first.resource, third.resource);
  assert.equal(first.bytes, third.bytes);
  assert.equal(fixture.allocations(), 2);
  await pool.release(second);
  await pool.release(third);
  await pool.dispose();
  assert.equal(fixture.destructions(), fixture.allocations());
  const textures = new TexturePool(service);
  const texture = textures.acquire({size: [10, 10], format: 'rgba8unorm', usage: 16});
  assert.equal(texture.bytes, null);
  await textures.release(texture);
  await textures.dispose();
  await service.dispose();
});

test('Disposal during asynchronous acquisition destroys the late device', async () => {
  let returnAdapter;
  let destroyed = 0;
  const service = new GpuDevice({gpu: {requestAdapter: () => new Promise(resolve => { returnAdapter = resolve; })}});
  const pending = service.acquire();
  await service.dispose();
  returnAdapter({requestDevice: async () => ({destroy: () => destroyed++})});
  await assert.rejects(pending, /cancelled/);
  assert.equal(destroyed, 1);
});
