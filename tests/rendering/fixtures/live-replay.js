import {DrawingContext, DisplayList, diffDisplayLists, Canvas2DBackend} from '@sharpforge/rendering';
import {referenceCanvas} from '../references/canvas-primitives.js';
import {canvasPixels} from '../rgba.js';

function element(id, color, version = 1) {
  const drawing = new DrawingContext({elementId: id, version});
  drawing.DrawRoundedRectangle([8, 8, 88, 48], [4, 8, 12, 16], color,
    {brush: '#202020', thickness: 1.5, startCap: 'round', endCap: 'round'});
  drawing.DrawEllipse([30, 20, 48, 30], '#4060a0');
  return drawing.finish([0, 0, 128, 96]);
}

function raster(document, definition, list, resources) {
  const {canvas} = referenceCanvas(document, definition);
  const renderer = new Canvas2DBackend(canvas);
  try {
    list.replay(renderer, resources, {width: definition.width, height: definition.height, dpr: definition.dpr ?? 1});
    return canvasPixels(canvas);
  } finally {
    renderer.dispose();
    canvas.width = canvas.height = 0;
  }
}

/** The reference is live Canvas rendering before serialization, as required by the record/replay contract. */
export function createReplayFixture(definition, {document, resources}) {
  const first = element('replay:first', '#ff8060');
  const second = element('replay:second', '#609020');
  const drawing = new DrawingContext({elementId: definition.id, version: 1});
  drawing.DrawLayer({displayList: first});
  drawing.PushTransform([1, 0, 0, 1, 100, 32]);
  drawing.DrawLayer({displayList: second});
  drawing.Pop();
  const live = drawing.finish([0, 0, definition.width, definition.height]);
  const json = DisplayList.deserialize(live.serialize());
  const binary = DisplayList.deserialize(live.serialize({binary: true}));
  let reference;
  return {list: binary, width: definition.width, height: definition.height,
    verify() {
      reference = raster(document, definition, live, resources);
      for (const [name, list] of [['JSON', json], ['UTF-8', binary]]) {
        const replayed = raster(document, definition, list, resources);
        if (replayed.data.length !== reference.data.length || replayed.data.some((byte, index) => byte !== reference.data[index])) {
          throw new Error(name + ' replay differs from live Canvas pixels');
        }
      }
      const changed = element('replay:first', '#2080c0', 2);
      const delta = diffDisplayLists([first, second], [changed, second]);
      if (delta.changed.length !== 1 || delta.changed[0].elementId !== first.elementId ||
          delta.retained.length !== 1 || delta.retained[0] !== second || delta.removed.length) {
        throw new Error('A one-property update did not preserve the other display-list identity');
      }
      let rejected = false;
      try { DisplayList.deserialize(JSON.stringify({...live.toData(), format: 999})); }
      catch (error) { if (error.code !== 'SFRENDER015') throw error; rejected = true; }
      if (!rejected) throw new Error('An unsupported replay envelope was accepted');
      return {passed: true, exactCanvasReplay: ['JSON', 'UTF-8'], changedElementIds: [first.elementId],
        retainedElementIds: [second.elementId], malformedEnvelopeDiagnostic: 'SFRENDER015'};
    },
    reference() {
      reference ??= raster(document, definition, live, resources);
      return {kind: 'canvas2d-live-replay', provider: 'live-canvas-before-serialization', glyphAccess: 'not-applicable',
        sharedRendererCode: true, scope: 'Serialization replay identity; not an independent geometry implementation', ...reference};
    }, dispose() { reference = null; }};
}
