import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClock} from '@sharpforge/framework';
import {Compositor} from '../packages/rendering/src/composition/compositor.js';
import {ElementCompositionPreview} from '../packages/rendering/src/composition/element-preview.js';
import {evaluateEffect, validateEffectGraph} from '../packages/rendering/src/composition/effects.js';
import {createCompositionLight} from '../packages/rendering/src/composition/lights.js';

const compositor = options => new Compositor({clockFactory: adapter => new AnimationClock(adapter), ...options});

test('Retained visual transforms and brush edits do not re-encode geometry or run layout', async () => {
  const comp = compositor();
  const root = comp.CreateContainerVisual();
  const visual = comp.CreateSpriteVisual();
  visual.Size = [100, 50];
  visual.Brush = comp.CreateColorBrush([1, 0, 0, 1]);
  root.Children.InsertAtTop(visual);
  comp.attach(root);
  const layers = comp.layers();
  const content = layers[0].children[0].displayList;
  const count = comp.contentEncodes;
  visual.Offset = [50, 20, 0];
  assert.equal(comp.layers()[0].children[0].displayList, content);
  assert.equal(comp.contentEncodes, count);
  visual.Brush.Color = [0, 0, 1, 1];
  assert.equal(comp.layers()[0].children[0].displayList, content);
  assert.equal(comp.resources.resolve(content.commands[0].brush).Color[2], 1);
  assert.throws(() => root.Children.InsertAtTop(root), /cycle/);
  assert.throws(() => { visual.Opacity = 2; });
  const other = compositor();
  assert.throws(() => { visual.Brush = other.CreateColorBrush(); });
  await comp.dispose();
  await other.dispose();
});

test('Clip and visual ownership snapshot restores state and reuses original object identity', async () => {
  const comp = compositor();
  const visual = comp.CreateSpriteVisual();
  visual.Size = [50, 50];
  visual.Clip = comp.CreateInsetClip(1, 2, 3, 4);
  visual.Properties.InsertScalar('ScaleFactor', 2);
  comp.attach(visual);
  const saved = comp.snapshot();
  visual.Offset = [20, 30, 0];
  visual.Properties.InsertScalar('ScaleFactor', 9);
  const extra = comp.CreateSpriteVisual();
  comp.restore(saved);
  assert.deepEqual(visual.Offset, [0, 0, 0]);
  assert.equal(visual.Properties.get('ScaleFactor'), 2);
  assert.equal(extra.closed, true);
  assert.deepEqual(comp.layers()[0].clip.rect, [1, 2, 46, 44]);
  await comp.dispose();
});

test('Element composition preview preserves hand-in visual above XAML and avoids layout mutation', async () => {
  const comp = compositor();
  const element = {};
  const changes = [];
  const preview = new ElementCompositionPreview(comp, {isElement: value => value === element,
    getLayout: () => ({width: 100, height: 80}), setComposition: (value, entry) => changes.push(entry)});
  const visual = preview.GetElementVisual(element);
  const child = comp.CreateSpriteVisual();
  preview.SetElementChildVisual(element, child);
  preview.SetIsTranslationEnabled(element, true);
  visual.Offset = [10, 20, 0];
  assert.equal(preview.GetElementVisual(element), visual);
  assert.equal(preview.GetElementChildVisual(element), child);
  assert.equal(changes.at(-1).child, child);
  assert.deepEqual(visual.Properties.get('Translation'), [0, 0, 0]);
  assert.throws(() => preview.GetElementVisual({}));
  preview.dispose();
  await comp.dispose();
});

test('Effect graphs use premultiplied channels and reject unsupported graphs before rendering', () => {
  const input = {width: 1, height: 1, data: new Float32Array([0.5, 0, 0, 0.5])};
  const output = evaluateEffect({type: 'Opacity', opacity: 0.5, sources: [{type: 'Source', name: 'image'}]},
    {image: input}, {width: 1, height: 1});
  assert.deepEqual([...output.data], [0.25, 0, 0, 0.25]);
  assert.throws(() => validateEffectGraph({type: 'Unknown', sources: []}), /UNSUPPORTED/);
  const cycle = {type: 'GaussianBlur'};
  cycle.sources = [cycle];
  assert.throws(() => validateEffectGraph(cycle), /unbounded/);
  for (const kind of ['AmbientLight', 'PointLight', 'SpotLight', 'DistantLight', 'SceneLightingEffect']) {
    assert.throws(() => createCompositionLight(kind), /SF_RENDER_LIGHT_UNSUPPORTED/);
  }
});

test('Composition brush cycles are rejected before descriptors can recurse', async () => {
  const comp = compositor();
  const first = comp.CreateMaskBrush();
  const second = comp.CreateMaskBrush();
  first.Source = second;
  assert.throws(() => { second.Source = first; }, /cycle/);
  assert.equal(second.Source, null);
  await comp.dispose();
});
