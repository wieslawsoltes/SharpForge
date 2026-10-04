import { size, rect, finite, insets, innerSize, addInsets, LayoutError } from './geometry.js';

function placement(context, available) {
  const properties = context.properties;
  const horizontal = properties.Orientation === 1 || properties.Orientation === 'Horizontal';
  const first = context.children[0];
  const probe = first ? context.measure(first, available) : size(0, 0);
  const width = Math.max(1, finite(properties.ItemWidth, probe.width || 1));
  const height = Math.max(1, finite(properties.ItemHeight, probe.height || 1));
  const mainLength = horizontal ? available.width : available.height;
  const cellLength = horizontal ? width : height;
  const requested = Math.max(0, Math.trunc(finite(properties.MaximumRowsOrColumns)));
  const automatic = Number.isFinite(mainLength) ? Math.max(1, Math.floor(mainLength / cellLength)) : context.children.length || 1;
  const count = Math.min(10000, requested > 0 ? Math.min(requested, automatic) : automatic);
  const occupied = new Set();
  const placements = [];
  let cursor = 0;
  let farRow = 0;
  let farColumn = 0;
  for (const id of context.children) {
    const child = context.resolve(id).properties ?? {};
    if (child.Visibility === 1) {
      context.measure(id, size(0, 0));
      placements.push({ id, x: 0, y: 0, width: 0, height: 0 });
      continue;
    }
    const variable = context.node.type.endsWith('VariableSizedWrapGrid');
    const rawColumns = variable ? Math.max(1, Math.trunc(finite(child.WrapColumnSpan ?? child.ColumnSpan, 1))) : 1;
    const rawRows = variable ? Math.max(1, Math.trunc(finite(child.WrapRowSpan ?? child.RowSpan, 1))) : 1;
    const majorSpan = Math.min(count, horizontal ? rawColumns : rawRows);
    const minorSpan = horizontal ? rawRows : rawColumns;
    let major;
    let minor;
    while (true) {
      if (cursor > 1000000 || occupied.size + majorSpan * minorSpan > 1000000) {
        throw new LayoutError('SFUI1640', 'WrapGrid placement cell limit exceeded', id);
      }
      major = cursor % count;
      minor = Math.floor(cursor / count);
      if (major + majorSpan <= count && fits(occupied, major, minor, majorSpan, minorSpan, count)) break;
      cursor++;
    }
    for (let row = 0; row < minorSpan; row++) {
      for (let column = 0; column < majorSpan; column++) occupied.add((minor + row) * count + major + column);
    }
    const row = horizontal ? minor : major;
    const column = horizontal ? major : minor;
    const rows = horizontal ? minorSpan : majorSpan;
    const columns = horizontal ? majorSpan : minorSpan;
    const item = { id, x: column * width, y: row * height, width: columns * width, height: rows * height };
    placements.push(item);
    context.measure(id, size(item.width, item.height));
    farRow = Math.max(farRow, row + rows);
    farColumn = Math.max(farColumn, column + columns);
    cursor++;
  }
  return { placements, desired: size(farColumn * width, farRow * height) };
}

function fits(occupied, major, minor, majorSpan, minorSpan, count) {
  for (let row = 0; row < minorSpan; row++) {
    for (let column = 0; column < majorSpan; column++) {
      if (occupied.has((minor + row) * count + major + column)) return false;
    }
  }
  return true;
}

export const wrapGridLayout = {
  measure(context, available) {
    const inset = insets(context.properties);
    const result = placement(context, innerSize(available, inset));
    context.data.wrap = result;
    return addInsets(result.desired, inset);
  },
  arrange(context, finalSize) {
    const inset = insets(context.properties);
    const available = innerSize(finalSize, inset);
    const result = placement(context, available);
    const align = (actual, desired, value) => value === 1 ? (actual - desired) / 2 : value === 2 ? actual - desired : 0;
    const x = inset.left + align(available.width, result.desired.width, context.properties.HorizontalChildrenAlignment);
    const y = inset.top + align(available.height, result.desired.height, context.properties.VerticalChildrenAlignment);
    for (const item of result.placements) context.arrange(item.id, rect(x + item.x, y + item.y, item.width, item.height));
  }
};
