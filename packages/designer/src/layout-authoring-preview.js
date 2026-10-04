import {applyResponsivePreview} from './layout-authoring-responsive.js';
import {designRectangle, geometryInvariant} from './geometry-coordinates.js';
import {normalizeProperty, propertySchema} from './model.js';

/** Preview environment belongs to the view session, never to the serialized source document. */
export class DesignPreviewEnvironment {
  constructor(value = {}) {
    this.value = {width: null, height: null, scale: 1, theme: 'dark', contrast: 'normal', direction: 'ltr', state: null};
    this.update(value);
  }

  update(patch) {
    const next = {...this.value, ...patch};
    for (const key of ['width', 'height']) {
      geometryInvariant(next[key] === null || Number.isFinite(next[key]) && next[key] >= 100 && next[key] <= 10000,
        'SFD_PREVIEW_SIZE', 'Preview dimensions must be between 100 and 10000 pixels.');
    }
    geometryInvariant(Number.isFinite(next.scale) && next.scale >= .5 && next.scale <= 4,
      'SFD_PREVIEW_SCALE', 'Preview scale must be between 0.5 and 4.');
    geometryInvariant(['light', 'dark'].includes(next.theme) && ['normal', 'high'].includes(next.contrast)
      && ['ltr', 'rtl'].includes(next.direction), 'SFD_PREVIEW_ENVIRONMENT', 'Unknown preview theme, contrast, or flow direction.');
    this.value = next;
    return {...next};
  }

  document(source) {
    const width = this.value.width ?? source.width;
    const height = this.value.height ?? source.height;
    const preview = applyResponsivePreview(source, width / this.value.scale, this.value.state);
    preview.width = width;
    preview.height = height;
    return preview;
  }

  /** Apply appearance to a caller-owned resolved scene, after resources, samples and component instances. */
  applyToScene(scene) {
    for (const node of scene.nodes) {
      const schema = propertySchema(node.type);
      if (schema.RequestedTheme) node.properties.RequestedTheme = this.value.theme === 'light' ? 1 : 2;
      if (this.value.contrast !== 'high') continue;
      for (const [property, color] of [['Background', '#000000'], ['Foreground', '#ffffff'],
        ['BorderBrush', '#ffffff'], ['Fill', '#ffffff'], ['Stroke', '#ffff00']]) {
        if (schema[property]) node.properties[property] = normalizeProperty(node.type, property, color);
      }
    }
    return scene;
  }
}

/** Returns scroll offsets that retain the same design point under the pointer. */
export function anchoredDesignZoom(viewport, point, requestedZoom) {
  geometryInvariant(Number.isFinite(requestedZoom) && requestedZoom > 0 && viewport.zoom > 0,
    'SFD_ZOOM_VALUE', 'Zoom must be finite and positive.');
  const zoom = Math.max(.1, Math.min(8, requestedZoom));
  const x = (viewport.scrollLeft + point.x - viewport.originX) / viewport.zoom;
  const y = (viewport.scrollTop + point.y - viewport.originY) / viewport.zoom;
  return {zoom, scrollLeft: viewport.originX + x * zoom - point.x, scrollTop: viewport.originY + y * zoom - point.y};
}

export function fitDesignBounds(viewport, bounds, {padding = .1} = {}) {
  const rectangle = designRectangle(bounds);
  geometryInvariant(viewport.width > 0 && viewport.height > 0 && padding >= 0,
    'SFD_ZOOM_VIEWPORT', 'Fit requires a nonempty viewport.');
  const zoom = Math.max(.1, Math.min(8, viewport.width / (Math.max(1, rectangle.Width) * (1 + 2 * padding)),
    viewport.height / (Math.max(1, rectangle.Height) * (1 + 2 * padding))));
  return {zoom, scrollLeft: viewport.originX + (rectangle.Left + rectangle.Width / 2) * zoom - viewport.width / 2,
    scrollTop: viewport.originY + (rectangle.Top + rectangle.Height / 2) * zoom - viewport.height / 2};
}
