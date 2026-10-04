import {DrawingContext} from '@sharpforge/rendering';
import {createControlGallery} from './control-gallery.js';
import {declaredPainters} from './declared-painters.js';
import {createNumericTextFixture} from './numeric-text.js';
import {createPathReferenceFixture} from './path-reference.js';
import {createGeometryMatrix} from './geometry-matrix.js';
import {createDomTextFixture} from './dom-text.js';
import {createReplayFixture} from './live-replay.js';
import {createRetainedScrollFixture} from './retained-scroll.js';
import {createCanvasControlFixture} from './canvas-control.js';
import {createMixedOrderFixture} from './mixed-z-order.js';
import {createNativeXamlFixture} from './native-xaml.js';
import {createBitmapCaptureFixture} from './bitmap-capture.js';
import {createNativeImeFixture} from './native-ime.js';
import {createAtlasResidencyFixture} from './atlas-residency.js';
import {declaredReference} from '../references/index.js';

/** Fixed DIP fixtures deliberately include alpha, retained layers and resource handles. */
export function createFixture(definition, options) {
  const specialized = {
    'control-gallery': createControlGallery,
    'numeric-text': createNumericTextFixture,
    'path-reference': createPathReferenceFixture,
    'text': createDomTextFixture,
    'dom-text-layout': createDomTextFixture,
    'live-replay': createReplayFixture,
    'retained-scroll': createRetainedScrollFixture,
    'canvas-control': createCanvasControlFixture,
    'mixed-z-order': createMixedOrderFixture,
    'native-xaml': createNativeXamlFixture,
    'host-bitmap-capture': createBitmapCaptureFixture,
    'native-ime': createNativeImeFixture,
    'atlas-residency': createAtlasResidencyFixture
  };
  if (specialized[definition.scene]) return specialized[definition.scene](definition, options);
  if (['rounded-matrix', 'ellipse-lines'].includes(definition.scene)) {
    return {...createGeometryMatrix(definition), reference: () => declaredReference(options.document, definition)};
  }
  const {document, resources} = options;
  const context = new DrawingContext({elementId: definition.id, version: 1});
  const cleanup = [];
  const width = definition.width ?? 128, height = definition.height ?? 96;
  const build = declaredPainters[definition.scene];
  if (!build) throw new TypeError('Unknown conformance scene: ' + definition.scene);
  const services = build(context, {definition, resources, width, height, cleanup}) ?? {};
  return {list: context.finish([0, 0, width, height]), width, height, ...services,
    reference: () => declaredReference(document, definition),
    async dispose() { for (const close of cleanup) await close(); }};
}
