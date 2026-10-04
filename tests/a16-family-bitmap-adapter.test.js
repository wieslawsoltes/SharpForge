import test from 'node:test';
import assert from 'node:assert/strict';
import {UIExtensionRegistry} from '@sharpforge/winui-properties';
import {WriteableBitmap} from '@sharpforge/rendering';
import {registerMediaAdapters} from '../packages/winui-controls/src/media/adapters.js';

test('managed bitmap SetPixels keeps its boundary diagnostic and shared rendering buffer identity', () => {
  const registry = new UIExtensionRegistry();
  registerMediaAdapters(registry);
  const owner = {type: 'Microsoft.UI.Xaml.Media.Imaging.WriteableBitmap'};
  const model = new WriteableBitmap(1, 1);
  const bytes = [0, 0, 0, 0];
  let invalidations = 0;
  const context = {model: () => model, native: value => value, managed: value => value,
    items: value => value, state: () => bytes,
    services: {invalidateRendering: () => invalidations++}};
  const descriptor = {owner: owner.type, kind: 'method', name: 'SetPixels', parameters: ['byte[]'], result: 'void'};
  const buffer = model.PixelBuffer;
  assert.throws(() => registry.invoke(context, descriptor, owner, [[1, 2]]), error => error.code === 'SFUI16B2');
  assert.equal(model.Revision, 0);
  assert.equal(invalidations, 0);
  assert.equal(registry.invoke(context, descriptor, owner, [[255, 0, 0, 128]]).handled, true);
  assert.equal(model.PixelBuffer, buffer);
  assert.deepEqual([...buffer], [255, 0, 0, 128]);
  assert.deepEqual(bytes, [255, 0, 0, 128]);
  assert.equal(model.Revision, 1);
  assert.equal(invalidations, 1);
});
