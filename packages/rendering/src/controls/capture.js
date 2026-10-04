import {DrawingContext} from '../drawing/context.js';
import {DrawingError} from '../drawing/commands.js';
import {IDENTITY, inverse, multiply} from '../media/transforms.js';

/** Capture follows the retained visual tree, including child transforms, isolated opacity, and scroll/geometry clips. */
export function captureVisualDisplayList(host, entries, rootId, compositionEntries = new Map(), resources = null) {
  const root = host.getLayout(rootId);
  if (!root) throw new DrawingError('SFRENDER133', 'RenderTargetBitmap requires an attached visual');
  const context = new DrawingContext({elementId: rootId, version: root.version}), visited = new Set();
  const visit = (id, parentWorld, depth) => {
    if (depth > 80 || visited.has(id)) throw new DrawingError('SFRENDER133', 'Capture visual tree cycle or depth budget');
    const layout = host.getLayout(id), node = host.nodes.get(id);
    if (!layout || !node || node.properties.Visibility === 1) return;
    visited.add(id);
    const parentInverse = inverse(parentWorld);
    if (!parentInverse) return;
    const transform = multiply(parentInverse, layout.worldTransform), clip = layout.clip, opacity = node.properties.Opacity ?? 1;
    context.PushTransform(transform);
    if (clip) context.PushClip(node.properties.Clip ?? {kind: 'rectangle', rect: [clip.x, clip.y, clip.width, clip.height]});
    if (opacity !== 1) context.PushOpacity(opacity);
    const entry = entries.get(id);
    if (entry?.list) context.DrawLayer({displayList: entry.list});
    else {
      const element = host.elements.get(id);
      if (element?.tagName === 'IMG' && element.complete && element.naturalWidth) context.DrawImage({source: element,
        width: element.naturalWidth, height: element.naturalHeight}, [0, 0, layout.renderSize.width, layout.renderSize.height],
      {stretch: node.properties.Stretch ?? 2, nineGrid: node.properties.NineGrid});
      else if (element && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) {
        const capture = host.services.captureNativeElement?.(node, layout, element);
        if (!capture) throw new DrawingError('SFRENDER134', 'Native editing controls require a host capture adapter');
        context.DrawImage(capture, [0, 0, layout.renderSize.width, layout.renderSize.height]);
      }
    }
    for (const child of layout.children ?? []) visit(child, layout.worldTransform, depth + 1);
    const composition = compositionEntries.get(id);
    if (composition?.list) context.DrawLayer({displayList: composition.resources === resources ? composition.list :
      inlineCaptureResources(composition.list, composition.resources)});
    if (opacity !== 1) context.Pop();
    if (clip) context.Pop();
    context.Pop();
  };
  visit(rootId, root.worldTransform ?? IDENTITY, 0);
  return {list: context.finish(), width: root.renderSize.width, height: root.renderSize.height};
}

/** A capture can combine independent compositors; resolve their session handles before crossing resource tables. */
function inlineCaptureResources(value, resources, {active = new Set(), copies = new Map(), depth = 0} = {}) {
  if (!value || typeof value !== 'object') return value;
  if (value.nodeType || typeof value.getContext === 'function' || typeof value.close === 'function') return value;
  if (depth > 64 || active.has(value)) throw new DrawingError('SFRENDER133', 'Capture resource cycle or nesting budget');
  if (copies.has(value)) return copies.get(value);
  active.add(value);
  const source = value.session && Number.isSafeInteger(value.id) ? resources.resolve(value) : value;
  let result;
  const next = {active, copies, depth: depth + 1};
  if (source !== value) result = inlineCaptureResources(source, resources, next);
  else {
    result = Array.isArray(value) || ArrayBuffer.isView(value) ? [] : {};
    for (const [key, child] of Object.entries(value)) result[key] = inlineCaptureResources(child, resources, next);
  }
  active.delete(value); copies.set(value, result); return result;
}
