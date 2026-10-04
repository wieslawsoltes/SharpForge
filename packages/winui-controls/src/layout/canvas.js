import { size, rect, finite } from './geometry.js';

/** Canvas children do not contribute to the parent's desired size and are not implicitly clipped. */
export const canvasLayout = {
  measure(context) {
    for (const child of context.children) context.measure(child, size(Infinity, Infinity));
    return size();
  },
  arrange(context) {
    for (const child of context.children) {
      const state = context.state(child);
      const properties = state.node.properties ?? {};
      context.arrange(child, rect(finite(properties.$Left ?? properties.Left ?? properties['Canvas.Left']),
        finite(properties.$Top ?? properties.Top ?? properties['Canvas.Top']), state.desiredSize.width, state.desiredSize.height));
    }
  }
};

export function canvasPaintOrder(children, resolve) {
  return children.map((id, index) => ({ id, index, z: finite(resolve(id)?.properties?.ZIndex) }))
    .sort((left, right) => left.z - right.z || left.index - right.index).map(entry => entry.id);
}
