import { size, rect, insets, innerSize, addInsets, LayoutError } from './geometry.js';

const axes = [
  { length: 'width', position: 'x', before: 'Left', after: 'Right', center: 'HorizontalCenter', previous: 'RightOf', next: 'LeftOf' },
  { length: 'height', position: 'y', before: 'Top', after: 'Bottom', center: 'VerticalCenter', previous: 'Below', next: 'Above' }
];

function attached(properties, name) {
  return properties['RelativePanel.' + name] ?? properties[name];
}

function reference(value, names, ids) {
  if (value == null || value === false) return null;
  const id = typeof value === 'object' ? value.$ref : names.get(value) ?? value;
  if (!ids.has(id)) throw new LayoutError('SFUI1630', `RelativePanel relation refers to a non-sibling: ${String(id)}`);
  return id;
}

function solve(context, available, axis) {
  const ids = new Set(context.children);
  const names = new Map(context.children.map(id => [context.resolve(id).properties?.Name, id]));
  const result = new Map();
  const visiting = new Set();
  const maximum = available[axis.length];
  const visit = id => {
    if (result.has(id)) return result.get(id);
    if (visiting.has(id)) throw new LayoutError('SFUI1631', 'Circular RelativePanel dependency', id);
    visiting.add(id);
    const properties = context.resolve(id).properties ?? {};
    const relation = name => {
      const target = reference(attached(properties, name), names, ids);
      return target ? visit(target) : null;
    };
    const before = relation('Align' + axis.before + 'With');
    const after = relation('Align' + axis.after + 'With');
    const previous = relation(axis.previous);
    const next = relation(axis.next);
    const centered = relation('Align' + axis.center + 'With');
    let start = attached(properties, 'Align' + axis.before + 'WithPanel') ? 0
      : before ? before.start : previous ? previous.start + previous.length : null;
    const end = attached(properties, 'Align' + axis.after + 'WithPanel') && Number.isFinite(maximum) ? maximum
      : after ? after.start + after.length : next ? next.start : null;
    let length = context.state(id).desiredSize[axis.length];
    if (start !== null && end !== null) length = Math.max(0, end - start);
    if (start === null) {
      if (end !== null) start = end - length;
      else if (attached(properties, 'Align' + axis.center + 'WithPanel') && Number.isFinite(maximum)) start = (maximum - length) / 2;
      else if (centered) start = centered.start + (centered.length - length) / 2;
      else start = 0;
    }
    const value = { start, length };
    result.set(id, value);
    visiting.delete(id);
    return value;
  };
  for (const id of context.children) visit(id);
  return result;
}

export const relativePanelLayout = {
  measure(context, available) {
    const inset = insets(context.properties);
    const content = innerSize(available, inset);
    for (const child of context.children) context.measure(child, content);
    const horizontal = solve(context, content, axes[0]);
    const vertical = solve(context, content, axes[1]);
    let width = 0;
    let height = 0;
    for (const child of context.children) {
      const x = horizontal.get(child);
      const y = vertical.get(child);
      context.measure(child, size(x.length, y.length));
      width = Math.max(width, x.start + x.length);
      height = Math.max(height, y.start + y.length);
    }
    return addInsets(size(width, height), inset);
  },
  arrange(context, finalSize) {
    const inset = insets(context.properties);
    const content = innerSize(finalSize, inset);
    const horizontal = solve(context, content, axes[0]);
    const vertical = solve(context, content, axes[1]);
    for (const child of context.children) {
      const x = horizontal.get(child);
      const y = vertical.get(child);
      context.arrange(child, rect(inset.left + x.start, inset.top + y.start, x.length, y.length));
    }
  }
};
