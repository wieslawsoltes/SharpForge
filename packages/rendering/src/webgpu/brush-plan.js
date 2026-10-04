import {DrawOp, DrawingError} from '../drawing/commands.js';
import {normalizeBrush, brushMatrix} from '../brushes/brushes.js';
import {transformPoint, inverse} from '../media/transforms.js';

/** Prepare nested composition brushes as GPU targets before the clipped geometry samples their result. */
export function prepareGpuBrush(plan, input, bounds, transform, commands, depth = 0) {
  if (depth > 32) throw new DrawingError('SFRENDER104', 'GPU brush graph exceeds nesting budget');
  const brush = normalizeBrush(input, plan.resources, plan.options.resolve);
  if (!brush || !['mask', 'effect', 'backdrop', 'acrylic'].includes(brush.kind)) return null;
  if (!plan.backend.capabilities.operations.effect) return null;
  if (['backdrop', 'acrylic'].includes(brush.kind) && (!plan.options.backdropAvailable || brush.alwaysUseFallback)) return null;
  const source = value => {
    const target = plan.target();
    target.commands = plan.compile([{op: DrawOp.Rectangle, rect: bounds, brush: value, pen: null}], transform, depth + 1);
    commands.push({kind: 'source', target}); return target.image;
  };
  let image;
  if (brush.kind === 'mask') {
    const program = plan.backend.effects.mask(source(brush.source), source(brush.mask), plan);
    commands.push({kind: 'effect', program}); image = program.output;
  } else if (brush.kind === 'effect') {
    const sources = Object.fromEntries(Object.entries(brush.sources).map(([name, value]) => [name, source(value)]));
    const program = plan.backend.effects.compile(brush.graph, sources, plan);
    commands.push({kind: 'effect', program}); image = program.output;
  } else {
    image = plan.backend.texturePool.acquire({size: [plan.backend.pixelWidth, plan.backend.pixelHeight],
      format: plan.backend.targetFormat, usage: 4 | 16 | 1 | 2});
    plan.effectTextures.push(image); commands.push({kind: 'backdrop', image});
    if (brush.kind === 'acrylic') {
      const graph = {type: 'Blend', mode: 'SourceOver', sources: [
        {type: 'ColorSource', color: [...brush.tint.slice(0, 3), brush.tint[3] * brush.tintOpacity]},
        {type: 'Saturation', saturation: 1.25, sources: [{type: 'GaussianBlur', blurAmount: brush.blur,
          sources: [{type: 'Source', name: 'Backdrop'}]}]}
      ]};
      const program = plan.backend.effects.compile(graph, {Backdrop: image}, plan, true);
      commands.push({kind: 'effect', program}); image = program.output;
      if (brush.noiseOpacity || brush.luminosityOpacity) {
        const details = plan.backend.effects.acrylicDetails(image, brush, plan);
        commands.push({kind: 'effect', program: details}); image = details.output;
      }
    }
  }
  const texture = {texture: image.resource, view: image.resource.createView(), sampler: plan.backend.sampler};
  const brushInverse = inverse(brushMatrix(brush, bounds));
  return {texture, color: [1, 1, 1, brushInverse ? brush.opacity : 0], paint: [2, 0, 0, 1], uv: point => {
    const world = transformPoint(transform, brushInverse ? transformPoint(brushInverse, point) : point);
    return [world[0] / plan.options.width, world[1] / plan.options.height];
  }};
}
