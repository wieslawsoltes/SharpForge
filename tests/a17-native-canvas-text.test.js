import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeCanvasTextProvider} from '../packages/rendering/src/text/native-canvas-provider.js';
import {TextLayoutService, caretRectangle, hitTestText, selectionRectangles} from '../packages/rendering/src/text/layout.js';
import {DrawingContext} from '../packages/rendering/src/drawing/context.js';
import {DisplayList} from '../packages/rendering/src/drawing/display-list.js';

/** API recorder only: native shaping/pixel qualification uses the real-browser corpus. */
function canvasRecorder() {
  const measured = [], painted = [], canvases = [];
  const createCanvas = (width, height) => {
    const context = {letterSpacing: '0px', wordSpacing: '0px', save() {}, restore() {}, scale() {}, translate() {},
      fillText(text) { painted.push(text); }, fillRect() {},
      measureText(text) {
        measured.push(text);
        return {width: text ? 42 : 0, fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 4,
          actualBoundingBoxLeft: 2, actualBoundingBoxRight: 43, actualBoundingBoxAscent: 13, actualBoundingBoxDescent: 4};
      }};
    const canvas = {width, height, getContext: () => context}; canvases.push(canvas); return canvas;
  };
  return {createCanvas, measured, painted, canvases};
}

test('worker Canvas drawing measures and paints intact opaque runs and sends only data to the host', () => {
  const recorder = canvasRecorder(), provider = new NativeCanvasTextProvider({createCanvas: recorder.createCanvas});
  const text = 'office العربية 👩‍💻', service = new TextLayoutService(provider);
  const run = service.layout(text, {fontSize: 16, wrapping: 'nowrap'});
  assert.equal(run.glyphAccess, 'opaque-native-runs');
  assert.equal(run.clusterAccess, 'unavailable');
  assert.ok(recorder.measured.every(value => value === text || value === 'Mg'));
  assert.equal(service.layout(text, {fontSize: 16, wrapping: 'nowrap'}), run);
  const encoded = new DrawingContext().DrawGlyphRun(run, [10, 20], 'red').finish();
  assert.deepEqual(DisplayList.deserialize(encoded.serialize()).commands[0].run, encoded.commands[0].run);
  const image = service.rasterize(run, {dpr: 1.5});
  assert.deepEqual(recorder.painted, [text]); assert.ok(image.origin[0] < 0);
  assert.ok(image.width > run.width * 1.5);
  for (const operation of [() => caretRectangle(run, 1), () => hitTestText(run, 10, 10), () => selectionRectangles(run, 0, 1)]) {
    assert.throws(operation, error => error.code === 'SFRENDER089');
  }
  assert.throws(() => service.layout(text, {wrapping: 'wrap'}), error => error.code === 'SFRENDER089');
  assert.throws(() => service.layout(text, {runs: [{start: 0, end: text.length, style: {}}]}), error => error.code === 'SFRENDER089');
  service.dispose(); assert.equal(recorder.canvases[0].width, 0);
  assert.throws(() => provider.rasterize(run), error => error.code === 'SFRENDER081');
});

test('worker font loading invalidates metrics, observes cancellation and bounds explicit line breaks', async () => {
  const recorder = canvasRecorder(), listeners = new Set(), loads = [];
  const fonts = {addEventListener(name, listener) { listeners.add(listener); }, removeEventListener(name, listener) { listeners.delete(listener); },
    async load(font, text) { loads.push({font, text}); }};
  const provider = new NativeCanvasTextProvider({createCanvas: recorder.createCanvas, fonts, maxLines: 2});
  const service = new TextLayoutService(provider);
  assert.equal((await service.shape('one\ntwo', {fontSize: 16})).lines.length, 2);
  assert.equal(loads.length, 1);
  service.layout('cached');
  for (const listener of listeners) listener();
  assert.equal(service.cache.size, 0);
  assert.throws(() => provider.layout('one\ntwo\nthree'), error => error.code === 'SFRENDER082');
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(service.shape('canceled', {signal: canceled.signal}), error => error.name === 'AbortError');
  service.dispose(); service.dispose(); assert.equal(listeners.size, 0);
});
