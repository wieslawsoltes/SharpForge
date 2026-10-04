import {normalizeProperty} from './model.js';
import {designRectangle, geometryInvariant} from './geometry-coordinates.js';
import {DesignOrderSession} from './geometry-order-session.js';

export const designArrangeActions = Object.freeze(['left', 'center', 'right', 'top', 'middle', 'bottom',
  'distribute-h', 'distribute-v', 'same-width', 'same-height', 'same-size']);

/** Align to the first selected rectangle; distribute outer edges with equal intervening gaps. */
export function arrangeRectangles(rectangles, action) {
  const entries = Object.entries(rectangles).map(([id, bounds]) => [id, designRectangle(bounds)]);
  geometryInvariant(entries.length >= 2, 'SFD_ARRANGE_SELECTION', 'Select at least two controls.');
  geometryInvariant(designArrangeActions.includes(action), 'SFD_ARRANGE_ACTION', 'Unknown arrangement command.');
  const primary = entries[0][1];
  const result = Object.fromEntries(entries);
  const align = {
    left: rectangle => ({Left: primary.Left}),
    center: rectangle => ({Left: primary.Left + (primary.Width - rectangle.Width) / 2}),
    right: rectangle => ({Left: primary.Left + primary.Width - rectangle.Width}),
    top: rectangle => ({Top: primary.Top}),
    middle: rectangle => ({Top: primary.Top + (primary.Height - rectangle.Height) / 2}),
    bottom: rectangle => ({Top: primary.Top + primary.Height - rectangle.Height}),
    'same-width': () => ({Width: primary.Width}),
    'same-height': () => ({Height: primary.Height}),
    'same-size': () => ({Width: primary.Width, Height: primary.Height})
  };
  if (align[action]) {
    for (const [, rectangle] of entries) Object.assign(rectangle, align[action](rectangle));
    return result;
  }
  geometryInvariant(entries.length >= 3, 'SFD_DISTRIBUTE_SELECTION', 'Select at least three controls to distribute.');
  const position = action === 'distribute-h' ? 'Left' : 'Top';
  const size = action === 'distribute-h' ? 'Width' : 'Height';
  entries.sort((left, right) => left[1][position] - right[1][position]);
  const start = entries[0][1][position];
  const last = entries.at(-1)[1];
  const occupied = entries.reduce((sum, [, rectangle]) => sum + rectangle[size], 0);
  const spacing = (last[position] + last[size] - start - occupied) / (entries.length - 1);
  let offset = start;
  for (const [, rectangle] of entries) {
    rectangle[position] = offset;
    offset += rectangle[size] + spacing;
  }
  return result;
}

export function arrangeDesignSelection(document, rectangles, action) {
  const ids = Object.keys(rectangles);
  const parent = document.parent(ids[0]);
  geometryInvariant(parent?.type.endsWith('.Canvas') && ids.every(id => document.parent(id)?.id === parent.id),
    'SFD_ARRANGE_PARENT', 'Pixel arrangement requires controls in the same Canvas.');
  const next = arrangeRectangles(rectangles, action);
  return document.change(`Arrange ${action}`, candidate => {
    const nodes = new Map(candidate.nodes.map(node => [node.id, node]));
    for (const [id, rectangle] of Object.entries(next)) {
      for (const [key, value] of Object.entries(rectangle)) {
        if (value !== rectangles[id][key]) nodes.get(id).properties[key] = normalizeProperty(nodes.get(id).type, key, value);
      }
    }
  });
}

/** Stable multi-selection ordering preserves order inside both selected and unselected sets. */
export function reorderDesignSelection(document, direction, ids = document.selection) {
  geometryInvariant(['front', 'back', 'forward', 'backward'].includes(direction), 'SFD_ORDER_ACTION', 'Unknown order command.');
  const session = new DesignOrderSession(document, {ids, label: `Order ${direction}`});
  session.update(direction);
  return session.commit();
}

export function resetDesignLayout(document, ids = document.selection) {
  return document.change('Reset layout', candidate => {
    const selected = new Set(ids);
    for (const node of candidate.nodes) {
      if (!selected.has(node.id)) continue;
      for (const key of ['Left', 'Top', 'Width', 'Height', 'Margin', 'HorizontalAlignment', 'VerticalAlignment',
        'Row', 'Column', 'RowSpan', 'ColumnSpan', 'ZIndex']) delete node.properties[key];
    }
  });
}
