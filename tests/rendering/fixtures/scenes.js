import {DrawingContext, BrowserTextProvider, TextLayoutService} from '@sharpforge/rendering';
import {compositionScene, effectGraph} from './composition-scenes.js';
import {createNumericTextFixture} from './numeric-text.js';
import {createPathReferenceFixture} from './path-reference.js';

const stroke = {brush: '#202020', thickness: 3, startCap: 'round', endCap: 'round', lineJoin: 'round'};
const gradient = {kind: 'linear', start: [0, 0], end: [1, 0], stops: [{offset: 0, color: '#ff0000'}, {offset: 1, color: '#0000ff'}]};

/** Fixed DIP fixtures deliberately include alpha, retained layers and resource handles. */
export function createFixture(definition, options) {
  if (definition.scene === 'numeric-text') return createNumericTextFixture(definition, options);
  if (definition.scene === 'path-reference') return createPathReferenceFixture(definition, options);
  const {document, resources} = options;
  const context = new DrawingContext({elementId: definition.id, version: 1});
  const cleanup = [];
  const width = definition.width ?? 128, height = definition.height ?? 96;
  const builders = {
    shapes() {
      context.DrawRectangle([4, 4, 32, 24], '#ff4030');
      context.DrawRoundedRectangle([44, 4, 32, 24], 6, '#4090ff');
      context.DrawEllipse([84, 4, 32, 24], '#20c050');
      context.DrawGeometry({kind: 'path', figures: [{start: [10, 40], closed: true, filled: true,
        segments: [{kind: 'line', end: [58, 40]}, {kind: 'line', end: [30, 84]}]}]}, '#9040c0', stroke);
    },
    strokes() {
      context.DrawLine([8, 12], [112, 12], {...stroke, dashArray: [2, 1], thickness: 4});
      context.DrawRoundedRectangle([12, 28, 92, 48], [2, 6, 10, 14], null, stroke);
    },
    gradients() {
      context.DrawRectangle([4, 4, 120, 36], gradient);
      context.DrawEllipse([28, 44, 72, 44], {kind: 'radial', center: [0.5, 0.5], radius: [0.5, 0.5],
        origin: [0.35, 0.5], stops: [{offset: 0, color: '#ffffff'}, {offset: 1, color: '#2080ff'}]});
    },
    images() {
      const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
      const image = resources.register('image', {width: 2, height: 2, pixels, alphaMode: 'straight', colorSpace: 'srgb'});
      context.DrawImage(image, [8, 8, 64, 64], {sampling: 'nearest', stretch: 'fill'});
      context.DrawImage(image, [80, 8, 32, 64], {sampling: 'linear', opacity: 0.5});
    },
    clips() {
      context.PushClip({kind: 'ellipse', rect: [8, 8, 104, 72]});
      context.PushTransform([1, 0.2, -0.1, 1, 8, 4]);
      context.DrawRectangle([0, 0, 128, 96], gradient);
      context.Pop();
      context.Pop();
    },
    effects() {
      const source = new DrawingContext({elementId: definition.id + ':source', version: 1});
      source.DrawRectangle([24, 24, 64, 32], '#c040ff');
      context.DrawLayer({displayList: source.finish([0, 0, width, height]), effect: effectGraph(definition.effectType ?? 'GaussianBlur')});
    },
    opacity() {
      context.PushOpacity(0.5);
      context.DrawRectangle([8, 8, 64, 56], '#ff0000');
      context.DrawRectangle([48, 28, 64, 56], '#ff0000');
      context.Pop();
    },
    text() {
      const provider = new BrowserTextProvider(document);
      const text = new TextLayoutService(provider);
      const run = text.layout('AV fi\nمرحبا\nA\u0301 👩‍💻', {fontSize: 16, fontFamily: 'sans-serif', width: 120, lineHeight: 24});
      context.DrawGlyphRun(resources.register('glyphRun', run), [4, 2], '#202020');
      cleanup.push(() => text.dispose());
      return {textService: text};
    },
    'instances-10k'() {
      for (let index = 0; index < 10000; index++) {
        context.DrawRectangle([index % 100 * 10, Math.floor(index / 100) * 10, 8, 8], index % 2 ? '#3080d0' : '#80c030');
      }
    },
    'composition-brushes'() { cleanup.push(compositionScene(context, definition, resources)); },
    'composition-trim'() { cleanup.push(compositionScene(context, definition, resources)); }
  };
  const build = builders[definition.scene];
  if (!build) throw new TypeError('Unknown conformance scene: ' + definition.scene);
  const services = build() ?? {};
  return {list: context.finish([0, 0, width, height]), width, height, ...services,
    async dispose() { for (const close of cleanup) await close(); }};
}
