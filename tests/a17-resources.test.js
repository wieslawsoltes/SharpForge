import test from 'node:test';
import assert from 'node:assert/strict';
import {ResourceTable} from '../packages/rendering/src/resources/resource-table.js';
import {RetirementQueue} from '../packages/rendering/src/webgpu/retirement.js';
import {DeltaUpload} from '../packages/rendering/src/webgpu/delta-upload.js';

test('Resource handles retain identity across changes and reject foreign, stale and mistyped uses', async () => {
  const resources = new ResourceTable();
  const changes = [];
  resources.subscribe(event => changes.push(event.reason));
  const handle = resources.register('brush', {color: 'red'});
  const other = new ResourceTable().register('brush', {color: 'blue'});
  assert.throws(() => resources.resolve(other));
  assert.throws(() => resources.resolve(handle, 'geometry'));
  resources.update(handle, {color: 'green'});
  assert.equal(resources.getVersion(handle), 2);
  assert.equal(resources.resolve(handle).color, 'green');
  resources.retain(handle);
  await resources.release(handle);
  assert.equal(resources.liveCount, 1);
  await resources.release(handle);
  assert.throws(() => resources.resolve(handle));
  const reused = resources.register('image', {});
  assert.equal(reused.id, handle.id);
  assert.equal(reused.generation, handle.generation + 1);
  assert.deepEqual(changes, ['register', 'update', 'release', 'register']);
  await resources.dispose();
  assert.throws(() => resources.register('brush', {}));
});

test('Released resource IDs cannot be reused before their GPU completion', async () => {
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  const retirement = new RetirementQueue();
  const resources = new ResourceTable({retirement});
  let destroyed = 0;
  const first = resources.register('image', {}, {dispose: () => destroyed++});
  const release = resources.release(first, {id: 1, done});
  const second = resources.register('image', {});
  assert.notEqual(first.id, second.id);
  assert.equal(destroyed, 0);
  complete();
  await release;
  assert.equal(destroyed, 1);
  const third = resources.register('image', {});
  assert.equal(first.id, third.id);
  await resources.dispose();
});

test('One changed instance among 10,000 uploads one aligned stride', () => {
  const delta = new DeltaUpload({capacity: 10000, stride: 32});
  const data = new Float32Array(8);
  for (let index = 0; index < 10000; index++) delta.set(index, data);
  const writes = [];
  const queue = {writeBuffer: (...args) => writes.push(args)};
  assert.equal(delta.flush(queue, {}).uploadedBytes, 320000);
  assert.deepEqual(delta.flush(queue, {}), {uploadedBytes: 0, ranges: 0});
  data[2] = 1;
  delta.set(7135, data);
  assert.deepEqual(delta.flush(queue, {}), {uploadedBytes: 32, ranges: 1});
  assert.equal(writes.at(-1)[1], 7135 * 32);
  assert.throws(() => delta.set(10000, data));
  delta.dispose();
  assert.throws(() => delta.set(0, data));
});
