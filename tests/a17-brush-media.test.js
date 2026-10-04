import test from 'node:test';
import assert from 'node:assert/strict';
import {Colors, parseColor, cssColor, colorFromArgb, colorEquals, colorDisplayName, srgbToLinear, linearToSrgb, premultiply}
  from '../packages/rendering/src/media/colors.js';
import {normalizeBrush, gradientColor, sampleBrush, brushMatrix} from '../packages/rendering/src/brushes/brushes.js';
import {ImageCache, WriteableBitmap, imageRectangle, nineGridPatches} from '../packages/rendering/src/media/images.js';
import {decodeSrgbPixels, encodeSrgbPixels, compositeLinear, halfToNumber} from '../packages/rendering/src/media/working-color.js';

const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const gradient = extras => normalizeBrush({kind: 'linear', start: [0, 0], end: [1, 0],
  stops: [{offset: 0, color: '#000000'}, {offset: 1, color: '#ffffff'}], ...extras});
const bitmap = (width = 2, height = 2) => ({width, height, closed: 0, close() { this.closed++; }});

test('typed ARGB colors retain named values, alpha conventions, equality and sRGB transfer points', () => {
  assert.equal(Object.keys(Colors).length, 141);
  assert.deepEqual(parseColor('#8f00'), [1, 0, 0, 136 / 255]);
  assert.deepEqual(parseColor('#80ff0000'), [1, 0, 0, 128 / 255]);
  assert.equal(cssColor(Colors.CornflowerBlue), 'rgba(100,149,237,1)');
  assert.ok(colorEquals(Colors.Aqua, Colors.Cyan));
  assert.equal(colorDisplayName(Colors.Red), 'Red');
  assert.deepEqual(premultiply([1, 0.5, 0.25, 0.4]), [0.4, 0.2, 0.1, 0.4]);
  near(srgbToLinear(0.5), 0.21404114048223255);
  for (const channel of [0, 0.02, 0.04045, 0.5, 1]) near(linearToSrgb(srgbToLinear(channel)), channel);
  for (const value of ['#12', '#12345', 'not-a-color', [1, 0, 0], [2, 0, 0, 1]]) assert.throws(() => parseColor(value));
  assert.throws(() => colorFromArgb(1.2, 0, 0, 0), error => error.code === 'SFRENDER050');
});

test('gradient interpolation, duplicate stops, spread and brush transforms have exact sampler semantics', () => {
  near(gradientColor(gradient(), 0.5)[0], 0.5);
  near(gradientColor(gradient({interpolation: 'linear'}), 0.5)[0], linearToSrgb(0.5));
  near(gradientColor(gradient({spread: 'repeat'}), 1.25)[0], 0.25);
  near(gradientColor(gradient({spread: 'reflect'}), 1.25)[0], 0.75);
  const bounds = [10, 20, 100, 50], moved = gradient({transform: [1, 0, 0, 1, 10, 0]});
  near(sampleBrush(moved, 70, 25, bounds)[0], 0.5);
  const relative = gradient({relativeTransform: [1, 0, 0, 1, 0.25, 0]});
  assert.deepEqual(brushMatrix(relative, bounds), [1, 0, 0, 1, 25, 0]);
  const radial = normalizeBrush({kind: 'radial', center: [0.5, 0.5], origin: [0.5, 0.5], radius: [0.5, 0.25],
    stops: [{offset: 0, color: 'red'}, {offset: 1, color: 'blue'}]});
  assert.deepEqual(sampleBrush(radial, 0.5, 0.5, [0, 0, 1, 1]), [1, 0, 0, 1]);
  assert.deepEqual(sampleBrush(radial, 1, 0.5, [0, 0, 1, 1]), [0, 0, 1, 1]);
  const edge = gradient({stops: [{offset: 0, color: 'red'}, {offset: 0.5, color: 'red'},
    {offset: 0.5, color: 'blue'}, {offset: 1, color: 'blue'}]});
  assert.deepEqual(gradientColor(edge, 0.5001), [0, 0, 1, 1]);
  for (const value of [{mapping: 'unknown'}, {interpolation: 'unknown'}, {radius: [-1, 1]}, {stops: new Array(4097)}]) {
    assert.throws(() => gradient(value));
  }
  assert.throws(() => normalizeBrush({kind: 'nine-grid', insets: [1, 2]}), error => error.code === 'SFRENDER052');
  const cycle = {kind: 'XamlCompositionBrushBase'}; cycle.CompositionBrush = cycle;
  assert.throws(() => normalizeBrush(cycle), error => error.code === 'SFRENDER052');
});

test('image placement preserves aspect ratio, explicit source clipping and undersized nine-grid corners', () => {
  const source = {width: 100, height: 50};
  assert.deepEqual(imageRectangle(source, [0, 0, 80, 80], {stretch: 2}).destination, [0, 20, 80, 40]);
  assert.deepEqual(imageRectangle(source, [0, 0, 80, 80], {stretch: 3}).destination, [-40, 0, 160, 80]);
  assert.deepEqual(imageRectangle(source, [0, 0, 80, 80], {stretch: 0, alignmentX: 0, alignmentY: 2}).destination, [0, 30, 100, 50]);
  assert.deepEqual(imageRectangle(source, [0, 0, 40, 20], {source: [-10, 0, 20, 10], stretch: 1}),
    {source: [0, 0, 10, 10], destination: [20, 0, 20, 20]});
  const patches = nineGridPatches({width: 20, height: 20}, [0, 0, 6, 4], [4, 4, 4, 4]);
  assert.equal(patches.length, 9);
  assert.deepEqual(patches[0].destination, [0, 0, 3, 2]);
  assert.deepEqual(patches[8].destination, [3, 2, 3, 2]);
  assert.equal(patches[4].destination[2], 0);
  assert.throws(() => imageRectangle(source, [0, 0, 10, 10], {stretch: 9}), error => error.code === 'SFRENDER064');
  assert.throws(() => imageRectangle(source, [0, 0, 10, 10], {stretch: 2, alignmentX: 4}));
  assert.throws(() => nineGridPatches(source, [0, 0, 10, 10], [-1, 1, 1, 1]));
});

test('image decoder caches by source and size, closes losers and retains live leases under budget pressure', async () => {
  let calls = 0;
  const decoded = [];
  const cache = new ImageCache({maxBytes: 16, decode: async (input, options) => {
    calls++; const value = bitmap(options.resizeWidth ?? 2, options.resizeHeight ?? 2); decoded.push(value); return value;
  }});
  const source = {}, first = await cache.acquire(source);
  assert.equal(await cache.get(source), first.image);
  assert.equal(calls, 1);
  await assert.rejects(cache.acquire({}), error => error.code === 'SFRENDER063');
  assert.equal(decoded[1].closed, 1);
  assert.equal(decoded[0].closed, 0);
  first.release(); first.release();
  await cache.get({}, {width: 1, height: 1});
  assert.equal(decoded[0].closed, 1);
  cache.dispose();
  assert.equal(decoded[2].closed, 1);
  await assert.rejects(cache.get(source), error => error.code === 'SFRENDER060');
  const withoutLoader = new ImageCache({decode: async () => bitmap()});
  await assert.rejects(withoutLoader.get('https://example.invalid/image.png'), error => error.code === 'SFRENDER061');
  withoutLoader.dispose();
});

test('image cancellation and concurrent completion release every uncommitted decoded image', async () => {
  const pending = [], cache = new ImageCache({decode: () => new Promise(resolve => pending.push(resolve))});
  const first = cache.get('same', {key: 'shared'}).catch(error => error);
  assert.equal((await first).code, 'SFRENDER061');
  const source = {}, left = cache.get(source), right = cache.get(source), a = bitmap(), b = bitmap();
  pending[0](a); const winner = await left;
  pending[1](b); assert.equal(await right, winner); assert.equal(b.closed, 1);
  const abort = new AbortController(), canceled = cache.get({}, {signal: abort.signal}), c = bitmap();
  abort.abort(); pending[2](c);
  await assert.rejects(canceled, error => error.name === 'AbortError');
  assert.equal(c.closed, 1);
  const inFlight = cache.get({}), d = bitmap(); cache.dispose(); pending[3](d);
  await assert.rejects(inFlight, error => error.code === 'SFRENDER060');
  assert.equal(a.closed, 1); assert.equal(d.closed, 1);
});

test('bitmap invalidation and premultiplied linear blending preserve typed bytes and transparent color', () => {
  const bitmap = new WriteableBitmap(1, 1), values = [];
  bitmap.subscribe(value => values.push(value.version));
  bitmap.PixelBuffer.set([255, 0, 0, 128]); bitmap.Invalidate();
  assert.deepEqual(values, [1]);
  const red = decodeSrgbPixels(bitmap.PixelBuffer), destination = decodeSrgbPixels(new Uint8Array([0, 0, 255, 255]));
  compositeLinear(red, destination);
  const encoded = encodeSrgbPixels(destination);
  assert.ok(encoded[0] >= 187 && encoded[0] <= 189);
  assert.ok(encoded[2] >= 186 && encoded[2] <= 188);
  assert.equal(encoded[3], 255);
  assert.deepEqual(Array.from(encodeSrgbPixels(decodeSrgbPixels(new Uint8Array([200, 100, 50, 0])))), [0, 0, 0, 0]);
  near(halfToNumber(0x3c00), 1); near(halfToNumber(0x3800), 0.5); near(halfToNumber(0x0001), 2 ** -24);
  bitmap.dispose();
  assert.throws(() => bitmap.Invalidate(), error => error.code === 'SFRENDER060');
  assert.throws(() => new WriteableBitmap(0.5, 1));
});
