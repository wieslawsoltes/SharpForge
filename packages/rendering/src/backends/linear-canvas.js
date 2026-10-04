import {DrawOp, DrawingError} from '../drawing/commands.js';
import {IDENTITY, multiply, inverse} from '../media/transforms.js';
import {decodeSrgbPixels, encodeSrgbPixels, compositeLinear} from '../media/working-color.js';
import {parseColor, srgbToLinear} from '../media/colors.js';

const pushes = new Set([DrawOp.PushTransform, DrawOp.PushClip, DrawOp.PushOpacity]);

/** Bounded reference compositor uses native coverage/shaping and performs source-over in Float32 linear light. */
export class LinearCanvasCompositor {
  constructor({createCanvas, createRenderer, maxBlendPixels = 67108864}) {
    this.createCanvas = createCanvas; this.createRenderer = createRenderer; this.maxBlendPixels = maxBlendPixels;
  }
  render(canvas, list, resources, options) {
    const width = Math.max(1, Math.ceil(options.width * options.dpr)), height = Math.max(1, Math.ceil(options.height * options.dpr));
    const pixels = width * height;
    if (pixels > 4194304) throw new DrawingError('SFRENDER140', 'Linear Canvas target exceeds its reference pixel budget');
    const work = {pixels: 0}, context = canvas.getContext('2d');
    const retained = options.clear === false && !options.damage && canvas.width === width && canvas.height === height ?
      decodeSrgbPixels(context.getImageData(0, 0, width, height).data) : null;
    const result = this.evaluate(list.commands, resources, {...options, pixelWidth: width, pixelHeight: height}, {work, retained});
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const image = context.createImageData(width, height); encodeSrgbPixels(result, {output: image.data}); context.putImageData(image, 0, 0);
    return {backend: 'canvas2d', blendColorSpace: 'linear', targetFormat: 'float32-reference',
      pixelWidth: width, pixelHeight: height, commands: list.commands.length, blendPixels: work.pixels, damagePolicy: 'full-repaint'};
  }
  evaluate(commands, resources, options, {initial = [], work, depth = 0, retained = null}) {
    if (depth > 64) throw new DrawingError('SFRENDER140', 'Linear layer nesting budget exceeded');
    const result = retained ?? new Float32Array(options.pixelWidth * options.pixelHeight * 4);
    const scratch = this.createCanvas(options.pixelWidth, options.pixelHeight), renderer = this.createRenderer(scratch);
    let transform = IDENTITY;
    const prefix = [...initial], stack = [];
    for (const command of initial) if (command.op === DrawOp.PushTransform) transform = multiply(transform, command.transform);
    const raster = command => {
      work.pixels += options.pixelWidth * options.pixelHeight;
      if (work.pixels > this.maxBlendPixels) throw new DrawingError('SFRENDER140', 'Linear Canvas blend work budget exceeded');
      const list = {commands: [...prefix, command, ...prefix.map(() => ({op: DrawOp.Pop}))]};
      renderer.render(list, resources, {...options, blendColorSpace: 'srgb', layerBlendColorSpace: 'linear', clear: true, damage: null});
      return scratch.getContext('2d').getImageData(0, 0, options.pixelWidth, options.pixelHeight).data;
    };
    const clipMask = () => {
      if (!prefix.some(command => command.op === DrawOp.PushClip)) return null;
      const undo = inverse(transform);
      if (!undo) return new Uint8ClampedArray(result.length);
      prefix.push({op: DrawOp.PushTransform, transform: undo});
      const mask = raster({op: DrawOp.Rectangle, rect: [0, 0, options.width, options.height], brush: '#ffffff'});
      prefix.pop(); return mask;
    };
    try {
      for (let index = 0; index < commands.length; index++) {
        const command = commands[index];
        if (command.op === DrawOp.PushTransform || command.op === DrawOp.PushClip) {
          stack.push(transform); prefix.push(command);
          if (command.op === DrawOp.PushTransform) transform = multiply(transform, command.transform);
        } else if (command.op === DrawOp.Pop) { transform = stack.pop(); prefix.pop(); }
        else if (command.op === DrawOp.PushOpacity) {
          let end = index + 1, nesting = 1;
          for (; end < commands.length && nesting; end++) {
            if (pushes.has(commands[end].op)) nesting++;
            else if (commands[end].op === DrawOp.Pop) nesting--;
          }
          if (nesting) throw new DrawingError('SFRENDER011', 'Unbalanced linear opacity layer');
          const child = this.evaluate(commands.slice(index + 1, end - 1), resources, options,
            {initial: [{op: DrawOp.PushTransform, transform}], work, depth: depth + 1});
          compositeLinear(child, result, command.opacity, clipMask()); index = end - 1;
        } else if (command.op === DrawOp.Clear) this.clear(result, parseColor(command.color), clipMask());
        else {
          if (command.brush && command.pen) {
            compositeLinear(decodeSrgbPixels(raster({...command, pen: null})), result);
            compositeLinear(decodeSrgbPixels(raster({...command, brush: null})), result);
          } else compositeLinear(decodeSrgbPixels(raster(command)), result);
        }
      }
      return result;
    } finally { renderer.dispose(); scratch.width = scratch.height = 0; }
  }
  clear(destination, color, mask) {
    const alpha = color[3], source = [...color.slice(0, 3).map(value => srgbToLinear(value) * alpha), alpha];
    for (let index = 0; index < destination.length; index += 4) {
      const coverage = mask ? mask[index + 3] / 255 : 1;
      for (let channel = 0; channel < 4; channel++) {
        destination[index + channel] = source[channel] * coverage + destination[index + channel] * (1 - coverage);
      }
    }
  }
}
