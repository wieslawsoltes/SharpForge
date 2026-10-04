import {owned} from './composition-object.js';
import {CompositionBrush} from './brushes.js';
import {finite, color} from './values.js';

const effects = Object.freeze({GaussianBlur: 1, Saturation: 1, Blend: 2, ColorSource: 0, Opacity: 1, ArithmeticComposite: 2, Tint: 1});

/** Pins a bounded, data-only Win2D effect subset before a factory can be created. */
export function validateEffectGraph(graph, {maxNodes = 64, maxDepth = 16} = {}) {
  let nodes = 0;
  const visiting = new Set();
  const visit = (node, depth) => {
    if (!node || depth > maxDepth || ++nodes > maxNodes || visiting.has(node)) throw new TypeError('Invalid or unbounded composition effect graph');
    visiting.add(node);
    if (node.type === 'Source') {
      if (typeof node.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(node.name)) throw new TypeError('Invalid effect source name');
      visiting.delete(node);
      return Object.freeze({type: 'Source', name: node.name});
    }
    if (!Object.hasOwn(effects, node.type)) throw new TypeError(`SF_RENDER_EFFECT_UNSUPPORTED: ${node.type}`);
    const sources = node.sources ?? (node.source ? [node.source] : []);
    if (sources.length !== effects[node.type]) throw new TypeError(`Invalid source count for ${node.type}`);
    const properties = normalizeEffectProperties(node);
    const result = Object.freeze({type: node.type, name: node.name ?? '', ...properties,
      sources: Object.freeze(sources.map(source => visit(source, depth + 1)))});
    visiting.delete(node);
    return result;
  };
  return visit(graph, 0);
}

export function effectSourceNames(graph) {
  const names = new Set();
  const pending = [graph];
  while (pending.length) {
    const node = pending.pop();
    if (node.type === 'Source') names.add(node.name);
    else pending.push(...node.sources);
  }
  return names;
}

function normalizeEffectProperties(node) {
  const normalizers = {
    GaussianBlur: () => ({blurAmount: finite(node.blurAmount ?? 3, 'blur amount', 0, 64)}),
    Saturation: () => ({saturation: finite(node.saturation ?? 1, 'saturation', 0, 2)}),
    Opacity: () => ({opacity: finite(node.opacity ?? 1, 'effect opacity', 0, 1)}),
    ColorSource: () => ({color: color(node.color ?? [0, 0, 0, 0])}),
    Tint: () => ({color: color(node.color ?? [1, 1, 1, 1])}),
    Blend: () => {
      const mode = node.mode ?? 'SourceOver';
      if (!['SourceOver', 'Multiply', 'Screen', 'Add'].includes(mode)) throw new TypeError(`SF_RENDER_EFFECT_UNSUPPORTED: Blend.${mode}`);
      return {mode};
    },
    ArithmeticComposite: () => ({coefficients: (node.coefficients ?? [0, 1, 0, 0]).map(value => finite(value, 'arithmetic coefficient', -10, 10))})
  };
  const result = normalizers[node.type]();
  if (result.coefficients?.length !== undefined && result.coefficients.length !== 4) throw new TypeError('Four arithmetic coefficients required');
  return result;
}

export class CompositionEffectFactory {
  constructor(compositor, graph, animatableProperties = []) {
    this.Compositor = compositor;
    this.graph = validateEffectGraph(graph);
    this.closed = false;
    if (animatableProperties.length) throw new TypeError('SF_RENDER_EFFECT_ANIMATION_UNSUPPORTED: animate source brushes or visual opacity');
  }
  CreateBrush() {
    if (this.closed) throw new Error('CompositionEffectFactory is disposed');
    return new CompositionEffectBrush(this.Compositor, this.graph);
  }
  retainedValues() { return [this.Compositor]; }
  snapshot() { return {graph: this.graph}; }
  restore(snapshot) { this.closed = false; this.graph = snapshot.graph; }
  dispose() { this.closed = true; }
}

export class CompositionEffectBrush extends CompositionBrush {
  constructor(compositor, graph) {
    const validated = validateEffectGraph(graph);
    super(compositor, 'CompositionEffectBrush');
    this.graph = validated;
    this.sources = new Map();
  }
  SetSourceParameter(name, brush) {
    owned(brush, this, value => value.kind.endsWith('Brush'));
    if (!effectSourceNames(this.graph).has(name) && !(brush === null && this.sources.has(name))) {
      throw new TypeError('Unknown effect source parameter');
    }
    this.Compositor.link(this, this.sources.get(name), brush);
    if (brush === null) this.sources.delete(name);
    else this.sources.set(name, brush);
    this.changed('Sources');
  }
  GetSourceParameter(name) { return this.sources.get(name) ?? null; }
  *retainedValues() { yield* super.retainedValues(); yield* this.sources.values(); }
  snapshot() { return {...super.snapshot(), graph: this.graph, sources: [...this.sources]}; }
  restore(snapshot) { super.restore(snapshot); this.graph = snapshot.graph; this.sources = new Map(snapshot.sources); }
  descriptor() { return {kind: 'effect', graph: this.graph, opacity: this.Opacity,
    sources: Object.fromEntries([...this.sources].map(([name, brush]) => [name, brush.descriptor()]))}; }
  dispose() {
    if (this.closed) return;
    super.dispose();
    this.sources.clear();
  }
}

function surface(width, height) { return {width, height, data: new Float32Array(width * height * 4)}; }
const clamp = value => Math.max(0, Math.min(1, value));

function filterPixels(node, inputs, output) {
  const data = output.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    const first = inputs[0]?.data;
    const second = inputs[1]?.data;
    const alpha = first?.[offset + 3] ?? 1;
    for (let channel = 0; channel < 4; channel++) {
      const value = first?.[offset + channel] ?? 0;
      const other = second?.[offset + channel] ?? 0;
      if (node.type === 'ColorSource') data[offset + channel] = node.color[channel] * (channel < 3 ? node.color[3] : 1);
      else if (node.type === 'Opacity') data[offset + channel] = value * node.opacity;
      else if (node.type === 'Tint') data[offset + channel] = value * node.color[channel] * (channel < 3 ? node.color[3] : 1);
      else if (node.type === 'Saturation') {
        const gray = first[offset] * 0.2126 + first[offset + 1] * 0.7152 + first[offset + 2] * 0.0722;
        data[offset + channel] = channel === 3 ? alpha : Math.min(alpha, clamp(gray + (value - gray) * node.saturation));
      } else if (node.type === 'ArithmeticComposite') {
        const [product, source, destination, constant] = node.coefficients;
        data[offset + channel] = clamp(product * value * other + source * value + destination * other + constant);
      } else if (node.type === 'Blend') data[offset + channel] = blend(node.mode, value, other, alpha, second[offset + 3], channel);
    }
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.min(data[offset + channel], data[offset + 3]);
  }
  return output;
}

function blend(mode, source, destination, sourceAlpha, destinationAlpha, channel) {
  if (mode === 'Add') return clamp(source + destination);
  if (channel === 3 || mode === 'SourceOver') return source + destination * (1 - sourceAlpha);
  if (mode === 'Multiply') return source * destination + source * (1 - destinationAlpha) + destination * (1 - sourceAlpha);
  return source + destination - source * destination;
}

function gaussianBlur(input, sigma) {
  if (!sigma) return {...input, data: input.data.slice()};
  const spacing = Math.max(1, sigma / 64);
  const radius = Math.min(192, Math.ceil(sigma * 3 / spacing));
  const weights = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let index = -radius; index <= radius; index++) total += (weights[index + radius] = Math.exp(-((index * spacing) ** 2) / (2 * sigma * sigma)));
  for (let index = 0; index < weights.length; index++) weights[index] /= total;
  const temporary = surface(input.width, input.height);
  const output = surface(input.width, input.height);
  blurPass(input, temporary, weights, {horizontal: true, spacing});
  blurPass(temporary, output, weights, {horizontal: false, spacing});
  return output;
}

function blurPass(input, output, weights, {horizontal, spacing}) {
  const {width, height, data} = input;
  const radius = (weights.length - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const destination = (y * width + x) * 4;
      for (let offset = -radius; offset <= radius; offset++) {
        const coordinate = Math.max(0, Math.min((horizontal ? width : height) - 1,
          (horizontal ? x : y) + offset * spacing));
        const first = Math.floor(coordinate);
        const second = Math.min(first + 1, (horizontal ? width : height) - 1);
        const fraction = coordinate - first;
        const source = (horizontal ? y * width + first : first * width + x) * 4;
        const adjacent = (horizontal ? y * width + second : second * width + x) * 4;
        const weight = weights[offset + radius];
        for (let channel = 0; channel < 4; channel++) {
          output.data[destination + channel] += (data[source + channel] * (1 - fraction) + data[adjacent + channel] * fraction) * weight;
        }
      }
    }
  }
}

/** Premultiplied RGBA fallback: blurAmount is in DIPs, DPR scales it, and sampling clamps image edges. */
export function evaluateEffect(graph, sources, {width, height, maxPixels = 4194304, dpr = 1} = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > maxPixels) {
    throw new RangeError('Composition effect pixel budget exceeded');
  }
  finite(dpr, 'effect DPR', Number.EPSILON, 64);
  const root = validateEffectGraph(graph);
  const visit = node => {
    if (node.type === 'Source') {
      const source = sources[node.name];
      if (!source || source.width !== width || source.height !== height || source.data.length !== width * height * 4) {
        throw new TypeError(`Invalid effect image source: ${node.name}`);
      }
      return source;
    }
    const inputs = node.sources.map(visit);
    return node.type === 'GaussianBlur' ? gaussianBlur(inputs[0], node.blurAmount * dpr) : filterPixels(node, inputs, surface(width, height));
  };
  return visit(root);
}
