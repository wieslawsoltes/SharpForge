import { size, rect, finite } from './geometry.js';

/** TwoPaneView uses available effective pixels, independent of devicePixelRatio. */
export function twoPaneGeometry(properties, available) {
  const priority = properties.PanePriority === 1 ? 1 : 0;
  const wide = available.width > finite(properties.MinWideModeWidth, 641);
  const tall = available.height > finite(properties.MinTallModeHeight, 641) && !wide;
  let mode = wide ? 'Wide' : tall ? 'Tall' : 'SinglePane';
  const configuration = wide ? properties.WideModeConfiguration ?? 0 : properties.TallModeConfiguration ?? 0;
  if (configuration === 2 || configuration === 'SinglePane') mode = 'SinglePane';
  if (mode === 'SinglePane') return { mode, panes: [priority === 0 ? rect(0, 0, available.width, available.height) : rect(),
    priority === 1 ? rect(0, 0, available.width, available.height) : rect()] };
  const horizontal = mode === 'Wide';
  const length = horizontal ? available.width : available.height;
  const first = properties.Pane1Length ?? { Value: 1, GridUnitType: 2 };
  const second = properties.Pane2Length ?? { Value: 1, GridUnitType: 2 };
  let firstLength;
  if (first.GridUnitType === 1) firstLength = Math.min(length, Math.max(0, first.Value));
  else if (second.GridUnitType === 1) firstLength = Math.max(0, length - second.Value);
  else firstLength = length * finite(first.Value, 1) / Math.max(1, finite(first.Value, 1) + finite(second.Value, 1));
  const reverse = configuration === 1;
  const firstStart = reverse ? length - firstLength : 0;
  const secondStart = reverse ? 0 : firstLength;
  return { mode, panes: horizontal
    ? [rect(firstStart, 0, firstLength, available.height), rect(secondStart, 0, length - firstLength, available.height)]
    : [rect(0, firstStart, available.width, firstLength), rect(0, secondStart, available.width, length - firstLength)] };
}

export const twoPaneLayout = {
  measure(context, available) {
    let desired = size();
    for (const child of context.children) {
      const next = context.measure(child, available);
      desired = size(Math.max(desired.width, next.width), Math.max(desired.height, next.height));
    }
    return desired;
  },
  arrange(context, finalSize) {
    const geometry = twoPaneGeometry(context.properties, finalSize);
    context.data.mode = geometry.mode;
    context.children.forEach((id, index) => context.arrange(id, geometry.panes[index] ?? rect()));
  }
};

export function parallaxOffset(offset, extent, viewport, shift, clamped = true) {
  const range = Math.max(0, extent - viewport);
  const progress = range > 0 ? offset / range : 0;
  return -shift * (clamped ? Math.max(0, Math.min(1, progress)) : progress);
}

/** Annotation anchors share the same extent coordinate system as the owning scroll model. */
export class AnnotatedScrollBarModel {
  constructor({ minimum = 0, maximum = 0, viewport = 0, onScroll = () => {} } = {}) {
    this.minimum = minimum;
    this.maximum = maximum;
    this.viewport = viewport;
    this.onScroll = onScroll;
    this.annotations = [];
  }
  position(value, trackLength) {
    return Math.max(0, Math.min(1, (value - this.minimum) / Math.max(1, this.maximum - this.minimum))) * trackLength;
  }
  request(position, trackLength) {
    const ratio = Math.max(0, Math.min(1, position / Math.max(1, trackLength)));
    const value = this.minimum + ratio * Math.max(0, this.maximum - this.minimum);
    this.onScroll({ value, kind: 'Absolute' });
    return value;
  }
}
