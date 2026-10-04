import {evaluateEffect, validateEffectGraph} from '../composition/effects.js';
import {srgbToLinear, linearToSrgb} from '../media/colors.js';

function convertPixels(surface, transfer) {
  const data = new Float32Array(surface.data.length);
  for (let index = 0; index < data.length; index += 4) {
    const alpha = surface.data[index + 3]; data[index + 3] = alpha;
    for (let channel = 0; channel < 3; channel++) {
      data[index + channel] = alpha ? transfer(Math.max(0, Math.min(1, surface.data[index + channel] / alpha))) * alpha : 0;
    }
  }
  return {...surface, data};
}
function linearGraph(node) {
  if (node.type === 'Source') return node;
  return {...node, color: node.color?.map((value, index) => index === 3 ? value : srgbToLinear(value)), sources: node.sources.map(linearGraph)};
}

/** Canvas and GPU evaluate the same graph in the selected working light space, then return premultiplied sRGB. */
export function evaluateWorkingEffect(graph, sources, options) {
  const linear = (options.layerBlendColorSpace ?? options.blendColorSpace) === 'linear';
  if (!linear) return evaluateEffect(graph, sources, options);
  const input = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, convertPixels(source, srgbToLinear)]));
  return convertPixels(evaluateEffect(linearGraph(validateEffectGraph(graph)), input, options), linearToSrgb);
}
