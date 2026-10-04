import {normalizeProperty, propertySchema, track} from './model.js';
import {designRectangle, geometryInvariant} from './geometry-coordinates.js';

const changedProperties = ['Left', 'Top', 'Width', 'Height', 'Margin', 'Row', 'Column', 'RowSpan', 'ColumnSpan',
  'HorizontalAlignment', 'VerticalAlignment'];

function axisTracks(rectangles, size, position, length) {
  const edges = new Set([0, size]);
  for (const rectangle of rectangles.values()) {
    edges.add(Math.max(0, rectangle[position]));
    edges.add(Math.max(0, rectangle[position] + rectangle[length]));
  }
  const offsets = [...edges].sort((left, right) => left - right);
  if (offsets.length === 1 || [...rectangles.values()].some(rectangle => Math.max(0, rectangle[position]) === offsets.at(-1))) {
    offsets.push(offsets.at(-1));
  }
  geometryInvariant(offsets.length <= 65, 'SFD_CONVERT_TRACK_LIMIT',
    'Preserving this Canvas requires more than 64 Grid tracks on one axis. Group controls before converting.');
  return {offsets, tracks: offsets.slice(1).map((value, index) => track(value - offsets[index]))};
}

function occupiedTracks(axis, start, size) {
  const position = Math.max(0, start);
  const end = Math.max(position, start + size);
  const first = Math.min(axis.tracks.length - 1, axis.offsets.indexOf(position));
  const last = Math.max(first + 1, axis.offsets.indexOf(end));
  return {position: first, span: last - first};
}

function editableNode(node, canEdit) {
  geometryInvariant(canEdit(node.id) !== false, 'SFD_CONVERT_READ_ONLY', 'Unlock the Canvas and its children before converting.');
  for (const property of changedProperties) {
    geometryInvariant(!node.bindings?.[property] && !node.resourceReferences?.[property], 'SFD_CONVERT_EXPRESSION',
      `Conversion cannot replace the authored ${node.id}.${property} expression.`);
  }
}

function childRectangle(node, measured) {
  const margin = node.properties.Margin ?? {};
  const width = node.properties.Width ?? measured?.Width;
  const height = node.properties.Height ?? measured?.Height;
  geometryInvariant(Number.isFinite(width) && Number.isFinite(height), 'SFD_CONVERT_MEASUREMENT',
    `Measure ${node.id} before converting a Canvas child with automatic size.`);
  const bounds = designRectangle({Left: node.properties.Left ?? 0, Top: node.properties.Top ?? 0,
    Width: width, Height: height});
  return {...bounds, Width: width + (margin.Left ?? 0) + (margin.Right ?? 0),
    Height: height + (margin.Top ?? 0) + (margin.Bottom ?? 0), contentWidth: width, contentHeight: height};
}

/** Convert one Canvas to pixel Grid tracks in one undo transaction, preserving identity, child order and arranged bounds.
 * `bounds` and `childBounds` are untransformed layout pixels; automatic child sizes require measured bounds.
 * Locked/protected nodes, expressions and more than 64 tracks fail before any document mutation.
 */
export function convertCanvasToGrid(document, {id = document.selection[0], bounds, childBounds = {}, canEdit = () => true,
  readOnly = false, expectedRevision = document.revision} = {}) {
  document.assertActive();
  const canvas = document.node(id);
  geometryInvariant(!readOnly && !document.readOnly, 'SFD_CONVERT_READ_ONLY', 'This document is read-only.');
  geometryInvariant(canvas?.type.endsWith('.Canvas'), 'SFD_CONVERT_PARENT', 'Select a Canvas to convert to Grid.');
  const children = canvas.children.map(child => document.node(child));
  for (const node of [canvas, ...children]) editableNode(node, canEdit);
  geometryInvariant(!canvas.style && !canvas.template, 'SFD_CONVERT_RESOURCE',
    'Detach Canvas-specific styles or templates before changing the container type.');
  for (const state of document.value.responsive?.states ?? []) {
    for (const child of children) {
      geometryInvariant(!changedProperties.some(property => Object.hasOwn(state.overrides?.[child.id] ?? {}, property)),
        'SFD_CONVERT_ADAPTIVE', 'Remove adaptive child layout overrides before converting their Canvas.');
    }
  }
  const width = canvas.properties.Width ?? bounds?.Width ?? document.value.width;
  const height = canvas.properties.Height ?? bounds?.Height ?? document.value.height;
  geometryInvariant(Number.isFinite(width) && Number.isFinite(height) && width >= 0 && height >= 0,
    'SFD_CONVERT_MEASUREMENT', 'Conversion requires finite Canvas dimensions.');
  const rectangles = new Map(children.map(child => [child.id, childRectangle(child, childBounds[child.id])]));
  const columns = axisTracks(rectangles, width, 'Left', 'Width');
  const rows = axisTracks(rectangles, height, 'Top', 'Height');
  const gridType = 'Microsoft.UI.Xaml.Controls.Grid';
  geometryInvariant(Object.keys(canvas.properties).every(property => propertySchema(gridType)[property]),
    'SFD_CONVERT_PROPERTY', 'The selected Canvas contains a property unsupported by Grid.');
  return document.change('Convert Canvas to Grid', candidate => {
    const nodes = new Map(candidate.nodes.map(node => [node.id, node]));
    const grid = nodes.get(id);
    grid.type = gridType;
    grid.rows = rows.tracks;
    grid.columns = columns.tracks;
    for (const [childId, rectangle] of rectangles) {
      const child = nodes.get(childId);
      const column = occupiedTracks(columns, rectangle.Left, rectangle.Width);
      const row = occupiedTracks(rows, rectangle.Top, rectangle.Height);
      Object.assign(child.properties, {Row: row.position, Column: column.position, RowSpan: row.span, ColumnSpan: column.span,
        Width: rectangle.contentWidth, Height: rectangle.contentHeight, HorizontalAlignment: 0, VerticalAlignment: 0});
      if (rectangle.Left < 0 || rectangle.Top < 0) {
        const margin = child.properties.Margin ?? {Left: 0, Top: 0, Right: 0, Bottom: 0};
        child.properties.Margin = normalizeProperty(child.type, 'Margin', {...margin,
          Left: margin.Left + Math.min(0, rectangle.Left), Top: margin.Top + Math.min(0, rectangle.Top)});
      }
      delete child.properties.Left;
      delete child.properties.Top;
    }
  }, {expectedRevision});
}
