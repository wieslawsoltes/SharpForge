export const HorizontalAlignment = Object.freeze({ Left: 0, Center: 1, Right: 2, Stretch: 3 });
export const VerticalAlignment = Object.freeze({ Top: 0, Center: 1, Bottom: 2, Stretch: 3 });
export const Orientation = Object.freeze({ Vertical: 0, Horizontal: 1 });
export const GridUnitType = Object.freeze({ Auto: 0, Pixel: 1, Star: 2 });

/** Layout errors carry stable codes; dimensions are device-independent pixels. */
export class LayoutError extends Error {
  constructor(code, message, nodeId = null) {
    super(message);
    this.name = 'LayoutError';
    this.code = code;
    this.nodeId = nodeId;
  }
}

/** Omitted dimensions default to zero; explicitly supplied values must be nonnegative numbers. */
export function size(width, height) {
  if (arguments.length === 0) width = 0;
  if (arguments.length < 2) height = 0;
  if (typeof width !== 'number' || typeof height !== 'number' || Number.isNaN(width) || Number.isNaN(height) || width < 0 || height < 0) {
    throw new LayoutError('SFUI1601', 'Measure dimensions must be nonnegative numbers');
  }
  return { width, height };
}

export function rect(x = 0, y = 0, width = 0, height = 0) {
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) {
    throw new LayoutError('SFUI1602', 'Arrange rectangles require finite coordinates and nonnegative dimensions');
  }
  return { x, y, width, height };
}

export function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function thickness(value) {
  if (typeof value === 'number') return { left: value, top: value, right: value, bottom: value };
  return {
    left: finite(value?.Left ?? value?.left), top: finite(value?.Top ?? value?.top),
    right: finite(value?.Right ?? value?.right), bottom: finite(value?.Bottom ?? value?.bottom)
  };
}

export function insets(properties) {
  const padding = thickness(properties.Padding);
  const border = thickness(properties.BorderThickness);
  return {
    left: padding.left + border.left, top: padding.top + border.top,
    right: padding.right + border.right, bottom: padding.bottom + border.bottom
  };
}

export function innerSize(available, inset) {
  return size(Math.max(0, available.width - inset.left - inset.right),
    Math.max(0, available.height - inset.top - inset.bottom));
}

export function addInsets(desired, inset) {
  return size(desired.width + inset.left + inset.right, desired.height + inset.top + inset.bottom);
}

export function clamp(value, minimum = 0, maximum = Infinity) {
  return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
}

export function sameSize(left, right) {
  return left && right && left.width === right.width && left.height === right.height;
}

export function sameRect(left, right) {
  return sameSize(left, right) && left.x === right.x && left.y === right.y;
}

export function roundEdge(value, scale = 1) {
  return Math.round(value * scale) / scale;
}

export function roundRect(value, scale) {
  const x = roundEdge(value.x, scale);
  const y = roundEdge(value.y, scale);
  return rect(x, y, roundEdge(value.x + value.width, scale) - x, roundEdge(value.y + value.height, scale) - y);
}

export function typeName(node) {
  return node.type?.slice(node.type.lastIndexOf('.') + 1) ?? '';
}
