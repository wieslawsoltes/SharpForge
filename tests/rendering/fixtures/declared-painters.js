import {DrawingContext, createControlRenderers} from '@sharpforge/rendering';
import {compositionScene, effectGraph} from './composition-scenes.js';

const stroke = {brush: '#202020', thickness: 3, startCap: 'round', endCap: 'round', lineJoin: 'round'};
const gradient = {kind: 'linear', start: [0, 0], end: [1, 0],
  stops: [{offset: 0, color: '#ff0000'}, {offset: 1, color: '#0000ff'}]};

function composition(context, {definition, resources, cleanup}) {
  cleanup.push(compositionScene(context, definition, resources));
}

/** Fixed fixture inputs enter the real display-list API; the separate reference modules do not consume this output. */
export const declaredPainters = Object.freeze({
  shapes(context) {
    context.DrawRectangle([4, 4, 32, 24], '#ff4030');
    context.DrawRoundedRectangle([44, 4, 32, 24], 6, '#4090ff');
    context.DrawEllipse([84, 4, 32, 24], '#20c050');
    context.DrawGeometry({kind: 'path', figures: [{start: [10, 40], closed: true, filled: true,
      segments: [{kind: 'line', end: [58, 40]}, {kind: 'line', end: [30, 84]}]}]}, '#9040c0', stroke);
  },
  strokes(context) {
    context.DrawLine([8, 12], [112, 12], {...stroke, dashArray: [2, 1], thickness: 4});
    context.DrawRoundedRectangle([12, 28, 92, 48], [2, 6, 10, 14], null, stroke);
  },
  gradients(context) {
    context.DrawRectangle([4, 4, 120, 36], gradient);
    context.DrawEllipse([28, 44, 72, 44], {kind: 'radial', center: [0.5, 0.5], radius: [0.5, 0.5],
      origin: [0.35, 0.5], stops: [{offset: 0, color: '#ffffff'}, {offset: 1, color: '#2080ff'}]});
  },
  images(context, {resources}) {
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
    const image = resources.register('image', {width: 2, height: 2, pixels, alphaMode: 'straight', colorSpace: 'srgb'});
    context.DrawImage(image, [8, 8, 64, 64], {sampling: 'nearest', stretch: 'fill'});
    context.DrawImage(image, [80, 8, 32, 64], {sampling: 'linear', opacity: 0.5});
  },
  clips(context) {
    context.PushClip({kind: 'ellipse', rect: [8, 8, 104, 72]});
    context.PushTransform([1, 0.2, -0.1, 1, 8, 4]);
    context.DrawRectangle([0, 0, 128, 96], gradient);
    context.Pop();
    context.Pop();
  },
  effects(context, {definition, width, height}) {
    const source = new DrawingContext({elementId: definition.id + ':source', version: 1});
    source.DrawRectangle([24, 24, 64, 32], '#c040ff');
    context.DrawLayer({displayList: source.finish([0, 0, width, height]), effect: effectGraph(definition.effectType ?? 'GaussianBlur')});
  },
  opacity(context) {
    context.PushOpacity(0.5);
    context.DrawRectangle([8, 8, 64, 56], '#ff0000');
    context.DrawRectangle([48, 28, 64, 56], '#ff0000');
    context.Pop();
  },
  'control-chrome'(context, {definition, resources, width, height}) {
    const node = {id: definition.id, type: 'Microsoft.UI.Xaml.Controls.' + definition.control,
      properties: {Background: '#f8f8f8', BorderBrush: '#808080',
        BorderThickness: {Left: 1, Top: 1, Right: 1, Bottom: 1}, CornerRadius: 4, IsEnabled: true}};
    const list = createControlRenderers().encode(node, {bounds: [0, 0, width, height], width, height}, resources);
    if (!list) throw new TypeError('Control fixture has no registered renderer: ' + definition.control);
    context.DrawLayer({displayList: list});
  },
  'instances-10k'(context) {
    for (let index = 0; index < 10000; index++) {
      context.DrawRectangle([index % 100 * 10, Math.floor(index / 100) * 10, 8, 8], index % 2 ? '#3080d0' : '#80c030');
    }
  },
  'instances-100k'(context) {
    for (let index = 0; index < 100000; index++) {
      context.DrawRectangle([index % 400 * 2, Math.floor(index / 400) * 2, 1.5, 1.5], '#3080d0');
    }
    return {verify(surface) {
      if (surface.backend !== 'webgpu') return {passed: true, primitives: 100000, batching: 'not-a-GPU-backend'};
      const commands = surface.renderer.plan.root.commands.filter(command => command.kind === 'draw');
      const instances = commands.reduce((sum, command) => sum + (command.mesh?.count ?? 0), 0);
      if (instances !== 100000 || commands.length > 2) throw new Error('100k homogeneous primitives require constant-count batches');
      return {passed: true, primitives: 100000, observedInstances: instances, observedBatches: commands.length};
    }};
  },
  'alpha-overlap'(context, {definition}) {
    for (const record of definition.overlaps) {
      context.PushOpacity(record.opacity);
      context.DrawRectangle(record.rect, record.color);
      context.Pop();
    }
  },
  'composition-brushes': composition,
  'composition-trim': composition
});
