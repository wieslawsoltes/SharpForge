import { ControlError } from '../policy/events.js';

function extent(value) {
  if (!Number.isFinite(value) || value < 0) throw new ControlError('SFUI1654', 'Command dimensions must be finite and nonnegative');
  return value;
}

/** Overflow is presentation state. Source collections and the remaining item order never change. */
export function partitionCommandBar(items, availableWidth, widthOf, { orderOf = item => item?.DynamicOverflowOrder ?? 0,
  enabled = true } = {}) {
  if (!Array.isArray(items) || items.length > 10_000) throw new ControlError('SFUI1654', 'Command collection exceeds its 10,000 item budget');
  if (Number.isNaN(availableWidth) || availableWidth < 0) throw new ControlError('SFUI1654', 'Invalid command bar width');
  const widths = items.map(item => extent(widthOf(item)));
  let width = widths.reduce((sum, value) => sum + value, 0);
  if (!enabled || width <= availableWidth) return { primary: [...items], overflow: [], width };
  const groups = new Map(), ordinary = [];
  for (let index = 0; index < items.length; index++) {
    const order = orderOf(items[index]) ?? 0;
    if (!Number.isSafeInteger(order) || order < 0) throw new ControlError('SFUI1654', 'DynamicOverflowOrder must be a nonnegative integer');
    if (!order) ordinary.push([index]);
    else {
      if (!groups.has(order)) groups.set(order, []);
      groups.get(order).push(index);
    }
  }
  const removal = [...groups].sort(([left], [right]) => left - right).map(([, group]) => group).concat(ordinary.reverse());
  const removed = new Set();
  for (const group of removal) {
    if (width <= availableWidth) break;
    for (const index of group) { removed.add(index); width -= widths[index]; }
  }
  return { primary: items.filter((_, index) => !removed.has(index)),
    overflow: items.filter((_, index) => removed.has(index)), width: Math.max(0, width) };
}

/** One coordinate system feeds managed Arrange and the native behavior parts. */
export function commandBarGeometry({ primary, secondary = [], available, content = { width: 0, height: 0 }, properties = {} },
  measure, orderOf) {
  const sizes = new Map([...primary, ...secondary].map(item => [item, measure(item)]));
  const naturalWidth = content.width + primary.reduce((sum, item) => sum + sizes.get(item).width, 0);
  const width = Number.isFinite(available.width) ? extent(available.width) : naturalWidth + (secondary.length ? 40 : 0);
  const toggle = properties.OverflowButtonVisibility === 2 || properties.OverflowButtonVisibility === 'Collapsed' ? 0 : 40;
  const labelPosition = properties.DefaultLabelPosition ?? 0;
  const changesWhenOpen = primary.length > 0 && (labelPosition === 0 || labelPosition === 'Bottom'
    || properties.ClosedDisplayMode === 1 || properties.ClosedDisplayMode === 2);
  const always = properties.OverflowButtonVisibility === 1 || properties.OverflowButtonVisibility === 'Visible' || changesWhenOpen;
  const contentWidth = Math.min(width, extent(content.width));
  let button = secondary.length || always ? toggle : 0;
  let partition = partitionCommandBar(primary, Math.max(0, width - contentWidth - button), item => sizes.get(item).width,
    { orderOf, enabled: properties.IsDynamicOverflowEnabled !== false });
  if (partition.overflow.length && !button && toggle) {
    button = toggle;
    partition = partitionCommandBar(primary, Math.max(0, width - contentWidth - button), item => sizes.get(item).width,
      { orderOf, enabled: properties.IsDynamicOverflowEnabled !== false });
  }
  const hidden = !properties.IsOpen && (properties.ClosedDisplayMode === 2 || properties.ClosedDisplayMode === 'Hidden');
  const minimal = !properties.IsOpen && (properties.ClosedDisplayMode === 1 || properties.ClosedDisplayMode === 'Minimal');
  const height = hidden ? 0 : minimal ? 24 : Math.max(48, content.height, ...partition.primary.map(item => sizes.get(item).height));
  const overflow = [...partition.overflow, ...secondary];
  const menuWidth = Math.min(width, Math.max(160, ...overflow.map(item => sizes.get(item).width)));
  const rectangles = new Map();
  let x = Math.max(contentWidth, width - button - partition.width);
  for (const item of partition.primary) {
    const desired = sizes.get(item);
    rectangles.set(item, { x, y: 0, width: desired.width, height, overflow: false, hidden: hidden || minimal });
    x += desired.width;
  }
  let y = height;
  for (const item of overflow) {
    const rowHeight = Math.max(32, sizes.get(item).height);
    rectangles.set(item, { x: Math.max(0, width - menuWidth), y, width: menuWidth, height: rowHeight,
      overflow: true, hidden: !properties.IsOpen && !properties.AlwaysExpanded });
    y += rowHeight;
  }
  return { ...partition, secondary: [...secondary], rectangles, width, height, menuWidth, menuHeight: y - height,
    content: { x: 0, y: 0, width: Math.max(0, width - button - partition.width), height },
    button: { x: Math.max(0, width - button), y: 0, width: button, height }, hidden, minimal };
}
