import { size, rect, thickness, clamp, finite, roundRect } from './geometry.js';

function axis(properties, name, available, margin) {
  const minimum = Math.max(0, finite(properties['Min' + name]));
  const maximum = Math.max(minimum, finite(properties['Max' + name], Infinity));
  const explicit = Number.isFinite(properties[name]) ? clamp(properties[name], minimum, maximum) : null;
  return { minimum, maximum, explicit, constraint: clamp(explicit ?? Math.max(0, available - margin), minimum, maximum) };
}

/** Compute FrameworkElement constraints without querying the renderer or DOM. */
export function measureElement(properties, available, measureOverride) {
  if (properties.Visibility === 1 || properties.Visibility === 'Collapsed') {
    return { desired: size(), unclipped: size(), content: size() };
  }
  const margin = thickness(properties.Margin);
  const horizontalMargin = margin.left + margin.right;
  const verticalMargin = margin.top + margin.bottom;
  const horizontal = axis(properties, 'Width', available.width, horizontalMargin);
  const vertical = axis(properties, 'Height', available.height, verticalMargin);
  const content = measureOverride(size(horizontal.constraint, vertical.constraint));
  if (!content || !Number.isFinite(content.width) || !Number.isFinite(content.height)) {
    throw new RangeError('MeasureOverride must return a finite desired size');
  }
  const width = clamp(horizontal.explicit ?? content.width, horizontal.minimum, horizontal.maximum);
  const height = clamp(vertical.explicit ?? content.height, vertical.minimum, vertical.maximum);
  return {
    desired: size(Math.max(0, Math.min(available.width, width + horizontalMargin)),
      Math.max(0, Math.min(available.height, height + verticalMargin))),
    unclipped: size(width, height), content
  };
}

function arrangeAxis(properties, name, start, length, before, after, desired, alignment) {
  const values = axis(properties, name, length, before + after);
  const available = Math.max(0, length - before - after);
  const numeric = typeof alignment === 'string' ? ({ Left: 0, Top: 0, Center: 1, Right: 2, Bottom: 2, Stretch: 3 })[alignment] : alignment;
  const align = numeric ?? 3;
  const actual = clamp(values.explicit ?? (align === 3 ? Math.max(desired, available) : desired), values.minimum, values.maximum);
  const remaining = available - actual;
  const offset = align === 1 ? remaining / 2 : align === 2 ? remaining : 0;
  return { start: start + before + offset, length: actual };
}

/** Layout slot includes margin; returned rectangle is the element's border box. */
export function arrangeElement(properties, slot, desired, scale = 1) {
  if (properties.Visibility === 1 || properties.Visibility === 'Collapsed') return rect(slot.x, slot.y, 0, 0);
  const margin = thickness(properties.Margin);
  const horizontal = arrangeAxis(properties, 'Width', slot.x, slot.width, margin.left, margin.right,
    desired.width, properties.HorizontalAlignment);
  const vertical = arrangeAxis(properties, 'Height', slot.y, slot.height, margin.top, margin.bottom,
    desired.height, properties.VerticalAlignment);
  const result = rect(horizontal.start, vertical.start, horizontal.length, vertical.length);
  return properties.UseLayoutRounding === false ? result : roundRect(result, scale);
}
