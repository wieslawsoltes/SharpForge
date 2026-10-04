import {canonicalType} from '@sharpforge/framework';
import {childSlot, propertySchema} from './model.js';
import {designRectangle, geometryInvariant} from './geometry-coordinates.js';

/** Returns the insertion index and its indicator in parent-local coordinates. */
export function layoutInsertion({children, point, orientation = 'vertical', wrap = false, bounds = null}) {
  geometryInvariant(['horizontal', 'vertical'].includes(orientation) && children.length <= 20000,
    'SFD_INSERT_LAYOUT', 'Unsupported insertion orientation or child count.');
  geometryInvariant(Number.isFinite(point.x) && Number.isFinite(point.y), 'SFD_INSERT_POINT', 'Insertion position must be finite.');
  const horizontal = orientation === 'horizontal';
  const position = horizontal ? 'Left' : 'Top';
  const size = horizontal ? 'Width' : 'Height';
  const cross = horizontal ? 'Top' : 'Left';
  const crossSize = horizontal ? 'Height' : 'Width';
  const coordinate = horizontal ? point.x : point.y;
  const crossCoordinate = horizontal ? point.y : point.x;
  const items = children.map((child, index) => ({...designRectangle(child.bounds ?? child), index}));
  let candidates = items;
  if (wrap && items.length) {
    let nearest = items[0];
    let distance = Infinity;
    for (const item of items) {
      const next = Math.max(item[cross] - crossCoordinate, crossCoordinate - item[cross] - item[crossSize], 0);
      if (next < distance) {
        distance = next;
        nearest = item;
      }
    }
    candidates = items.filter(item => item[cross] < nearest[cross] + nearest[crossSize]
      && item[cross] + item[crossSize] > nearest[cross]);
  }
  const before = candidates.find(item => coordinate < item[position] + item[size] / 2);
  const after = candidates.at(-1);
  const index = before?.index ?? (after ? after.index + 1 : 0);
  const anchor = before ?? after ?? designRectangle(bounds ?? {Width: 100, Height: 30});
  const offset = before ? before[position] : after ? after[position] + after[size] : 0;
  const indicator = horizontal ? {Left: offset, Top: anchor.Top, Width: 0, Height: anchor.Height}
    : {Left: anchor.Left, Top: offset, Width: anchor.Width, Height: 0};
  return {index, indicator};
}

/** Draw/create is one document edit. Cancellation is implemented by not invoking this commit. */
export function createDrawnControl(document, {type, parentId, bounds, index = null}) {
  type = canonicalType(type);
  const parent = document.node(parentId);
  const slot = childSlot(parent?.type ?? '');
  geometryInvariant(slot && (slot.many || !parent.children.length), 'SFD_CREATE_PARENT', 'Select a container with an available child slot.');
  const rectangle = designRectangle(bounds);
  geometryInvariant(rectangle.Width > 0 && rectangle.Height > 0, 'SFD_CREATE_EMPTY', 'Draw a nonempty rectangle to create a control.');
  const name = type.split('.').at(-1);
  let serial = 1;
  while (document.node(`${name}_${serial}`)) serial++;
  const id = `${name}_${serial}`;
  const schema = propertySchema(type);
  const properties = {Name: id, Width: rectangle.Width, Height: rectangle.Height};
  if (schema.Text) properties.Text = name;
  else if (schema.Content) properties.Content = name;
  if (parent.type.endsWith('.Canvas')) Object.assign(properties, {Left: rectangle.Left, Top: rectangle.Top});
  document.change(`Draw ${name}`, candidate => {
    const owner = candidate.nodes.find(node => node.id === parentId);
    geometryInvariant(index === null || Number.isInteger(index) && index >= 0 && index <= owner.children.length,
      'SFD_CREATE_INDEX', 'Insertion index is outside the child collection.');
    owner.children.splice(index ?? owner.children.length, 0, id);
    candidate.nodes.push({id, type, properties, children: [], events: {}});
  });
  document.select(id);
  return id;
}
