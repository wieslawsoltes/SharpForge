import test from 'node:test';
import assert from 'node:assert/strict';
import {TextLayoutService, caretRectangle, hitTestText, selectionRectangles, hybridTextInputPolicy}
  from '../packages/rendering/src/text/layout.js';
import {BrowserTextProvider} from '../packages/rendering/src/text/browser-provider.js';
import {inlineRuns, paintTextLayout} from '../packages/rendering/src/text/rich-text.js';
import {fitTextPrefix, sliceTextStyles, placeTrimmedLine} from '../packages/rendering/src/text/trimming.js';
import {textInkBounds} from '../packages/rendering/src/text/ink-bounds.js';

function clusterFixture() {
  const family = '👨‍👩‍👧‍👦', end = 1 + family.length;
  return {text: 'a' + family + 'ב', lineHeight: 16, lines: [{}], clusters: [
    {start: 0, end: 1, line: 0, rtl: false, rects: [[0, 0, 10, 16]]},
    {start: 1, end, line: 0, rtl: false, rects: [[10, 0, 20, 16]]},
    {start: end, end: end + 1, line: 0, rtl: true, rects: [[30, 0, 10, 16]]}
  ]};
}

test('cluster caret/hit/selection maps preserve surrogate, ZWJ and RTL boundaries', () => {
  const run = clusterFixture(), end = run.clusters[1].end;
  assert.deepEqual(caretRectangle(run, 2, 'forward'), [30, 0, 1, 16]);
  assert.deepEqual(caretRectangle(run, 2, 'backward'), [10, 0, 1, 16]);
  assert.deepEqual(caretRectangle(run, end), [40, 0, 1, 16]);
  assert.deepEqual(caretRectangle(run, end + 1), [30, 0, 1, 16]);
  assert.equal(hitTestText(run, 11, 8).position, 1);
  assert.equal(hitTestText(run, 29, 8).position, end);
  assert.equal(hitTestText(run, 31, 8).position, end + 1);
  assert.equal(hitTestText(run, 39, 8).position, end);
  assert.deepEqual(selectionRectangles(run, 2, 4), [[10, 0, 20, 16]]);
  assert.deepEqual(selectionRectangles(run, 0, end + 1), [[0, 0, 40, 16]]);
  assert.equal(hitTestText(run, 100, 100).inside, false);
  assert.deepEqual(caretRectangle({text: '', clusters: [], lines: [], lineHeight: 16}, 0), [0, 0, 1, 16]);
});

test('text layout cache owns invalidation, bounded residency, cancellation and provider disposal', async () => {
  const callbacks = new Set();
  const provider = {calls: 0, disposed: 0, fontVersion: 0,
    layout(text, options) { this.calls++; return {text, options, width: 20, height: 16, lines: [], clusters: []}; },
    rasterize() { return 'test raster'; }, subscribe(callback) { callbacks.add(callback); return () => callbacks.delete(callback); },
    dispose() { this.disposed++; }};
  const service = new TextLayoutService(provider, {maxEntries: 2, maxCharacters: 8}), a = service.layout('a', {width: 100});
  assert.equal(service.layout('a', {width: 100}), a);
  assert.equal(provider.calls, 1);
  service.layout('bb'); service.layout('ccc');
  assert.equal(service.cache.size, 2);
  assert.equal(service.characters, 5);
  let reflows = 0; service.subscribe(() => reflows++);
  provider.fontVersion++;
  for (const callback of callbacks) callback();
  assert.equal(service.cache.size, 0); assert.equal(reflows, 1);
  assert.equal((await service.shape('x')).text, 'x');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.shape('canceled', {signal: controller.signal}), error => error.name === 'AbortError');
  service.dispose(); service.dispose();
  assert.equal(provider.disposed, 1); assert.equal(callbacks.size, 0);
  assert.throws(() => service.layout('disposed'), error => error.code === 'SFRENDER081');
  assert.throws(() => new TextLayoutService(provider, {maxEntries: 0}), error => error.code === 'SFRENDER082');
  assert.throws(() => new BrowserTextProvider(null), error => error.code === 'SFRENDER080');
});

test('trimming performs bounded prefix measurements at complete graphemes and preserves span styling', () => {
  const text = 'A👩‍💻BC', boundaries = [1, 6, 7, 8];
  let calls = 0;
  const result = fitTextPrefix(text, boundaries, 7, value => { calls++; return value.length; });
  assert.deepEqual(result, {end: 6, text: 'A👩‍💻…'});
  assert.ok(calls <= 3);
  const long = 'x'.repeat(65536), indices = Array.from({length: long.length}, (_, index) => index + 1);
  calls = 0;
  assert.equal(fitTextPrefix(long, indices, 101, value => { calls++; return value.length; }).end, 100);
  assert.ok(calls <= 17);
  const bold = {fontWeight: 700}, italic = {fontStyle: 'italic'};
  assert.deepEqual(sliceTextStyles([{start: 0, end: 3, style: bold}, {start: 3, end: 8, style: italic}], 1, 5, 1), [
    {start: 0, end: 2, style: bold}, {start: 2, end: 4, style: italic}, {start: 4, end: 5, style: italic}]);
  const shaped = {lines: [{top: 1, baseline: 12, fontRuns: [{baseline: 12}]}], clusters: [
    {start: 0, end: 1, rects: [[0, 1, 5, 10]]}, {start: 1, end: 2, rects: [[5, 1, 4, 10]]}]};
  const placed = placeTrimmedLine(shaped, {top: 20, start: 4, end: 12}, 5, 1);
  assert.equal(placed.line.baseline, 31);
  assert.deepEqual(placed.clusters[1], {start: 5, end: 5, line: 1, rects: [[5, 20, 4, 10]]});
});

test('rich text inheritance retains contiguous UTF-16 spans and rejects recursive inline trees', () => {
  const text = {type: 'RichTextBlock', properties: {FontSize: 18}, collections: {Blocks: [
    {type: 'Paragraph', collections: {Inlines: [{type: 'Bold', collections: {Inlines: [
      {type: 'Run', properties: {Text: 'Bold'}}]}}, {type: 'Run', properties: {Text: ' normal'}}]}},
    {type: 'Paragraph', collections: {Inlines: [{type: 'Italic', properties: {Text: 'Italic'}}]}}
  ]}};
  const result = inlineRuns(text);
  assert.equal(result.text, 'Bold normal\nItalic');
  assert.equal(result.runs[0].style.fontWeight, 700);
  assert.equal(result.runs.at(-1).style.fontStyle, 'italic');
  assert.equal(result.runs.at(-1).style.fontSize, 18);
  result.runs.forEach((run, index) => assert.equal(run.start, index ? result.runs[index - 1].end : 0));
  text.collections.Blocks.push(text);
  assert.throws(() => inlineRuns(text), error => error.code === 'SFRENDER082');
  assert.equal(hybridTextInputPolicy.ime, 'native-input');
  assert.match(hybridTextInputPolicy.fallback, /DOM/);
});

test('native text painting keeps intact runs, spacing, colors and state restoration on failure', () => {
  const draws = [], context = {depth: 0, letterSpacing: '0px', wordSpacing: '0px',
    save() { this.depth++; }, restore() { this.depth--; }, fillText(...args) { draws.push({args, color: this.fillStyle, spacing: this.wordSpacing}); },
    fillRect() {}, beginPath() {}, rect() {}, clip() {}};
  const run = {font: '16px sans-serif', fontSize: 16, ascent: 12, descent: 4, options: {letterSpacing: 0.25}, lines: [
    {fontRuns: [{text: 'office العربية', font: '16px sans-serif', left: 0, width: 100, baseline: 12, direction: 'ltr', wordSpacing: 2,
      paints: [{style: {foreground: 'red', underline: true}, rects: null}]}]}]};
  paintTextLayout(context, run, {paint: value => value});
  assert.equal(draws.length, 1); assert.equal(draws[0].args[0], 'office العربية');
  assert.equal(draws[0].spacing, '2px'); assert.equal(context.depth, 0);
  assert.throws(() => paintTextLayout(context, run, {paint() { throw new Error('paint failed'); }}), /paint failed/);
  assert.equal(context.depth, 0);
  const unsupported = {...context}; delete unsupported.wordSpacing;
  assert.throws(() => paintTextLayout(unsupported, run), error => error.code === 'SFRENDER088');
});

test('native ink metrics reserve italic and accent overhangs', () => {
  const measurement = {save() {}, restore() {}, measureText: () => ({actualBoundingBoxLeft: 2,
    actualBoundingBoxRight: 15, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 3})};
  const run = {width: 10, height: 16, ascent: 10, descent: 3, font: 'italic 16px serif',
    lines: [{text: 'Áf', direction: 'ltr', left: 0, width: 10, baseline: 10}]};
  assert.deepEqual(textInkBounds(run, measurement), [-2, -2, 17, 18]);
});
