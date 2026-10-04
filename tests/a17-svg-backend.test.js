import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingContext} from '../packages/rendering/src/drawing/context.js';
import {SvgBackend} from '../packages/rendering/src/backends/svg.js';

/** Record DOM structure only; browser pixel comparisons belong to the conformance runner. */
function svgDocument() {
  const document = {createElement: name => new Element(name), createElementNS: (namespace, name) => new Element(name)};
  class Element {
    constructor(name) {
      this.name = name; this.ownerDocument = document; this.children = []; this.attributes = {}; this.style = {};
      this.classList = {add() {}};
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    get firstChild() { return this.children[0] ?? null; }
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null; }
    append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
    prepend(child) { child.remove(); child.parentNode = this; this.children.unshift(child); }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
    insertBefore(child, before) {
      child.remove(); child.parentNode = this;
      const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child);
    }
    remove() {
      if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    }
  }
  return document;
}
const elements = (root, name) => root.children.flatMap(child => [...(child.name === name ? [child] : []), ...elements(child, name)]);

test('SVG retains hollow strokes, scoped clips and gradient coordinate/color policies with unique resource IDs', () => {
  const document = svgDocument(), container = document.createElement('div');
  const backend = new SvgBackend(container, {idPrefix: 'first'});
  const stroke = new DrawingContext().DrawRoundedRectangle([0, 0, 30, 20], [6, 3], null, {brush: 'blue', width: 2}).finish();
  backend.render(stroke, null, {width: 40, height: 30, dpr: 2});
  assert.equal(elements(backend.svg, 'path').length, 1);
  assert.equal(elements(backend.svg, 'path')[0].attributes['fill-rule'], 'nonzero');
  const gradient = {kind: 'linear', start: [0, 0], end: [1, 0], spread: 'reflect', interpolation: 'linear',
    stops: [{offset: 0, color: 'red'}, {offset: 1, color: 'blue'}]};
  const list = new DrawingContext().PushTransform([1, 0, 0, 1, 5, 7])
    .PushClip({kind: 'rectangle', rect: [0, 0, 30, 20]}).DrawEllipse([0, 0, 30, 20], gradient).Pop().Pop().finish();
  const metrics = backend.render(list, null, {width: 40, height: 30, dpr: 2});
  assert.equal(metrics.pixelWidth, 80); assert.equal(backend.svg.attributes.viewBox, '0 0 40 30');
  const clip = elements(backend.svg, 'clipPath')[0], paint = elements(backend.svg, 'linearGradient')[0];
  assert.match(clip.attributes.id, /^sf-first-/); assert.notEqual(clip.attributes.id, paint.attributes.id);
  assert.equal(paint.attributes.gradientUnits, 'userSpaceOnUse'); assert.equal(paint.attributes['color-interpolation'], 'linearRGB');
  assert.equal(paint.attributes.spreadMethod, 'reflect'); assert.equal(paint.children.length, 2);
  assert.ok(elements(backend.svg, 'g').some(node => node.attributes['clip-path'] === `url(#${clip.attributes.id})`));
  backend.dispose(); backend.dispose(); assert.equal(container.children.length, 0);
  assert.throws(() => backend.render(list), error => error.code === 'SFRENDER094');
  assert.throws(() => new SvgBackend(container, {idPrefix: 'bad id'}), error => error.code === 'SFRENDER094');
});

test('SVG numeric text consumes glyph outlines and positions directly from the declared provider', () => {
  const document = svgDocument(), seen = [];
  const provider = {glyphPath(glyph) { seen.push(glyph.glyphId); return {path: 'M0 0 L10 0 L5 10 Z', scale: 0.02}; }};
  const backend = new SvgBackend(document.createElement('div'), {idPrefix: 'text', textService: {provider}});
  const run = {glyphAccess: 'numeric-glyphs', width: 30, height: 20,
    glyphs: [{glyphId: 42, x: 3, y: 16, foreground: 'red'}], decorations: [{rect: [0, 18, 30, 1]}]};
  backend.render(new DrawingContext().DrawGlyphRun(run, [5, 7], 'blue').finish(), null, {width: 40, height: 30});
  assert.deepEqual(seen, [42]);
  assert.equal(elements(backend.svg, 'path')[0].attributes.transform, 'translate(3 16) scale(0.02 -0.02)');
  assert.equal(elements(backend.svg, 'rect')[0].attributes.y, '18');
  assert.equal(elements(backend.svg, 'text').length, 0);
  backend.dispose();
});
