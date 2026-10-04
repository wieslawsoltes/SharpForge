import {layoutControlText} from './text-renderer.js';
import {measureShape} from './shape-renderer.js';

/** Layout and painting share native shaping and geometry services; other controls keep their existing intrinsic provider. */
export function createRenderingMeasureProvider({fallback, textService, resolve, textScale = () => 1}) {
  return {measure(node, available) {
    const type = node.type.split('.').at(-1), properties = node.properties;
    if (type === 'TextBlock' || type === 'RichTextBlock') {
      const width = properties.TextWrapping === 0 ? Infinity : available.width;
      const run = layoutControlText(node, width, textService, resolve, textScale());
      return {width: run.width, height: run.height};
    }
    if (['Rectangle', 'Ellipse', 'Line', 'Polygon', 'Polyline', 'Path'].includes(type)) return measureShape(node, available, resolve);
    return fallback.measure(node, available);
  }, invalidate() { fallback.invalidate?.(); textService.clear(); }, dispose() { fallback.dispose?.(); }};
}
