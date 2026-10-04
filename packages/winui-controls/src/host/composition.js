import { identityMatrix } from '../layout/render-properties.js';

const scalarProperties = new Set(['Opacity', '$Left', '$Top', 'Canvas.Left', 'Canvas.Top', 'Left', 'Top',
  'X', 'Y', 'TranslateX', 'TranslateY', 'ScaleX', 'ScaleY', 'Angle', 'Rotation', 'CenterX', 'CenterY', 'SkewX', 'SkewY']);

/** Transient render values live outside managed scene properties and are discarded independently. */
export class HostComposition {
  constructor(host) {
    this.host = host;
    this.overrides = new Map();
    this.brushes = new Map();
    this.brushPaint = new Map();
    this.elements = new Map();
    this.cache = new Map();
  }
  set(id, property, value) {
    if (!this.host.nodes.has(id)) throw new Error('SFUI1660: Composition target is not in this host');
    if (!scalarProperties.has(property)) return false;
    if (value !== undefined && !Number.isFinite(value)) throw new TypeError('SFUI1661: Composition value must be finite');
    let properties = this.overrides.get(id);
    if (!properties) this.overrides.set(id, properties = new Map());
    if (value === undefined) properties.delete(property);
    else properties.set(property, value);
    if (!properties.size) this.overrides.delete(id);
    this.cache.delete(id);
    this.host.scheduleRender();
    return true;
  }
  setElement(id, value = {}) {
    if (!this.host.nodes.has(id)) throw new Error('SFUI1660: Composition target is not in this host');
    if (value == null) {
      this.host.options.renderComposition?.(this.host.context, id, null, null);
      this.elements.delete(id);
      this.host.scheduleRender();
      return;
    }
    const { visual = null, child = null, translationEnabled = false } = value;
    if (this.elements.get(id)?.child !== child) this.host.options.renderComposition?.(this.host.context, id, null, null);
    this.elements.set(id, { visual, child, translationEnabled: !!translationEnabled });
    this.host.scheduleRender();
  }
  setBrush(id, property, brush) {
    if (!this.host.nodes.has(id)) throw new Error('SFUI1660: Composition target is not in this host');
    if (!['Background', 'BorderBrush', 'Foreground'].includes(property)) throw new TypeError('SFUI1661: Unsupported composition brush property');
    if (brush != null && typeof brush.descriptor !== 'function') throw new TypeError('SFUI1661: Composition brush requires descriptor()');
    let properties = this.brushes.get(id);
    if (!properties) this.brushes.set(id, properties = new Map());
    if (brush == null) properties.delete(property);
    else properties.set(property, brush);
    if (!properties.size) this.brushes.delete(id);
    if (!this.brushPaint.has(id)) this.brushPaint.set(id, new Set());
    this.brushPaint.get(id).add(property);
    this.cache.delete(id);
    this.host.scheduleRender();
  }
  resolve(id) {
    const node = this.host.nodes.get(id);
    const overrides = this.overrides.get(id);
    const brushes = this.brushes.get(id);
    if (!node || !overrides && !brushes) return node;
    let value = this.cache.get(id);
    if (!value) {
      value = { ...node, properties: { ...node.properties, ...Object.fromEntries(overrides ?? []) } };
      for (const [property, brush] of brushes ?? []) value.properties[property] = brush.descriptor();
      this.cache.set(id, value);
    }
    return value;
  }
  position(state) {
    const values = this.overrides.get(state.id);
    const properties = state.node.properties;
    const x = values?.get('$Left') ?? values?.get('Canvas.Left') ?? values?.get('Left');
    const y = values?.get('$Top') ?? values?.get('Canvas.Top') ?? values?.get('Top');
    return { x: state.rect.x + (x == null ? 0 : x - (properties.$Left ?? properties.Left ?? properties['Canvas.Left'] ?? 0)),
      y: state.rect.y + (y == null ? 0 : y - (properties.$Top ?? properties.Top ?? properties['Canvas.Top'] ?? 0)) };
  }
  matrix(id) {
    const entry = this.elements.get(id);
    const visual = entry?.visual;
    const matrix = visual?.matrix?.() ?? visual?.transform;
    if (!matrix) return identityMatrix;
    if (![6, 16].includes(matrix.length) || [...matrix].some(value => !Number.isFinite(value))) {
      throw new TypeError('SFUI1661: Invalid composition matrix');
    }
    const affine = matrix.length === 6 ? [...matrix] : [matrix[0], matrix[1], matrix[4], matrix[5], matrix[12], matrix[13]];
    if (entry.translationEnabled) {
      const translation = visual.Properties?.TryGetVector3?.('Translation')?.value;
      const base = this.host.nodes.get(id)?.properties.Translation;
      if (translation) {
        affine[4] += translation[0] - (base?.X ?? base?.[0] ?? 0);
        affine[5] += translation[1] - (base?.Y ?? base?.[1] ?? 0);
      }
    }
    return affine;
  }
  paint(id, element) {
    if (!element) return;
    const node = this.resolve(id);
    if (this.brushPaint.has(id)) {
      for (const [property, style] of [['Background', 'background'], ['BorderBrush', 'borderColor'], ['Foreground', 'color']]) {
        if (this.brushPaint.get(id).has(property)) element.style[style] = node.properties[property] == null
          ? '' : this.host.context.color(node.properties[property]);
      }
      if (!this.brushes.has(id)) this.brushPaint.delete(id);
    }
    const preview = this.elements.get(id);
    const opacity = preview?.visual?.Opacity ?? preview?.visual?.opacity ?? node?.properties.Opacity ?? 1;
    element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    if (preview?.visual?.IsVisible === false) element.style.visibility = 'hidden';
    else element.style.visibility = '';
    if (preview?.child) {
      const compositor = preview.child.Compositor;
      const layer = compositor?.layerFor?.(preview.child) ?? preview.child;
      this.host.options.renderComposition?.(this.host.context, id, layer, compositor?.resources);
    }
  }
  begin() { this.cache.clear(); }
  remove(id) {
    if (this.elements.has(id)) this.host.options.renderComposition?.(this.host.context, id, null, null);
    this.overrides.delete(id);
    this.brushes.delete(id);
    this.brushPaint.delete(id);
    this.elements.delete(id);
    this.cache.delete(id);
  }
  clear() {
    for (const id of this.elements.keys()) this.remove(id);
    this.overrides.clear();
    this.brushes.clear();
    this.brushPaint.clear();
    this.cache.clear();
  }
}
