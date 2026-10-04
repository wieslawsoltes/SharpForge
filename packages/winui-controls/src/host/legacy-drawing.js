const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const suffix = type => type.slice(type.lastIndexOf('.') + 1);

export function drawLegacyNode(host, node) {
  const { RenderSurface, parseColor, drawingPrimitives } = host.drawing;
    const type = suffix(node.type);
    if (type !== 'Canvas' && type !== 'DrawingSurface') return;
    const container = host.elements.get(node.id);
    const primitives = type === 'DrawingSurface' ? drawingPrimitives(node.drawing ?? []) : [];
    if (type === 'Canvas') {
      for (const value of node.collections.Children ?? []) {
        const shape = host.nodes.get(value.$ref);
        if (!shape || shape.properties.Visibility === 1 || !['Rectangle', 'Ellipse', 'Line'].includes(suffix(shape.type))) continue;
        const properties = shape.properties;
        const element = host.elements.get(shape.id);
        const layout = host.getLayout(shape.id);
        if (!element || !layout) continue;
        if (properties.RenderTransform?.$ref) { element.dataset.renderFallback = 'transformed shape uses DOM'; continue; }
        delete element.dataset.renderFallback;
        const x = layout.rect.x;
        const y = layout.rect.y;
        const width = layout.renderSize.width;
        const height = layout.renderSize.height;
        const stroke = number(properties.StrokeThickness, 1);
        if (suffix(shape.type) === 'Line') {
          primitives.push(...drawingPrimitives([{ op: 'DrawLine', args: [x + number(properties.X1), y + number(properties.Y1),
            x + number(properties.X2), y + number(properties.Y2), stroke, properties.Stroke] }]));
        } else {
          const kind = suffix(shape.type) === 'Ellipse' ? 1 : 0;
          if (properties.Fill) primitives.push({ x, y, w: width, h: height, color: parseColor(properties.Fill), kind, angle: 0 });
          // Stroke remains in the DOM until a drawing delegate provides a real pen command.
        }
        element.style.background = 'transparent';
      }
    }
    let surface = host.surfaces.get(node.id);
    if (!surface) {
      surface = new RenderSurface(container, { backend: host.backend, gpu: host.options.gpu, services: host.services,
        onMetrics: metrics => host.options.onMetrics({ id: node.id, ...metrics }) });
      host.surfaces.set(node.id, surface);
    }
    const layout = host.getLayout(node.id);
    surface.update(primitives, layout?.renderSize.width ?? 0, layout?.renderSize.height ?? 0, host.layoutEngine.scale);
  }

