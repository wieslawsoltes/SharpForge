import { size, rect, finite, insets, innerSize, addInsets, roundEdge, LayoutError } from './geometry.js';
import { createTracks, resolveTracks, trackExtent, trackPositions } from './grid-tracks.js';
import { distributeSpan, gridCell } from './grid-span.js';

function definitions(context, name, axis) {
  const records = (context.node.collections?.[name] ?? []).map(value => context.resolve(value.$ref)).filter(Boolean);
  if (records.length > 4096) throw new LayoutError('SFUI1621', 'Grid definition limit exceeded', context.id);
  return createTracks(records, axis);
}

function constraint(tracks, start, span, available, spacing) {
  let auto = false;
  let star = false;
  for (let index = start; index < start + span; index++) {
    auto ||= tracks[index].unit === 0;
    star ||= tracks[index].unit === 2;
  }
  if (auto && !star || star && !Number.isFinite(available)) return Infinity;
  return trackExtent(tracks, start, span, spacing);
}

export const gridLayout = {
  measure(context, available) {
    const inset = insets(context.properties);
    const content = innerSize(available, inset);
    const rows = definitions(context, 'RowDefinitions', 'Height');
    const columns = definitions(context, 'ColumnDefinitions', 'Width');
    const rowSpacing = Math.max(0, finite(context.properties.RowSpacing));
    const columnSpacing = Math.max(0, finite(context.properties.ColumnSpacing));
    const cells = context.children.map(id => ({ id, ...gridCell(context.resolve(id).properties ?? {}, rows.length, columns.length) }));
    cells.sort((left, right) => left.rowSpan * left.columnSpan - right.rowSpan * right.columnSpan);
    for (let pass = 0; pass < 8; pass++) {
      resolveTracks(columns, content.width, columnSpacing);
      resolveTracks(rows, content.height, rowSpacing);
      let changed = false;
      for (const cell of cells) {
        const desired = context.measure(cell.id, size(
          constraint(columns, cell.column, cell.columnSpan, content.width, columnSpacing),
          constraint(rows, cell.row, cell.rowSpan, content.height, rowSpacing)));
        changed = distributeSpan(columns, cell.column, cell.columnSpan, desired.width, columnSpacing) || changed;
        changed = distributeSpan(rows, cell.row, cell.rowSpan, desired.height, rowSpacing) || changed;
      }
      if (!changed) break;
    }
    context.data.grid = { rows, columns, rowSpacing, columnSpacing, cells };
    return addInsets(size(trackExtent(columns, 0, columns.length, columnSpacing, 'base'),
      trackExtent(rows, 0, rows.length, rowSpacing, 'base')), inset);
  },

  arrange(context, finalSize) {
    const data = context.data.grid;
    if (!data) return;
    const inset = insets(context.properties);
    const content = innerSize(finalSize, inset);
    resolveTracks(data.columns, content.width, data.columnSpacing);
    resolveTracks(data.rows, content.height, data.rowSpacing);
    const horizontal = trackPositions(data.columns, data.columnSpacing, inset.left);
    const vertical = trackPositions(data.rows, data.rowSpacing, inset.top);
    for (const cell of data.cells) {
      const x = roundEdge(horizontal[cell.column], context.scale);
      const y = roundEdge(vertical[cell.row], context.scale);
      const right = roundEdge(horizontal[cell.column] + trackExtent(data.columns,
        cell.column, cell.columnSpan, data.columnSpacing), context.scale);
      const bottom = roundEdge(vertical[cell.row] + trackExtent(data.rows, cell.row, cell.rowSpan, data.rowSpacing), context.scale);
      context.arrange(cell.id, rect(x, y, Math.max(0, right - x), Math.max(0, bottom - y)));
    }
    for (const [tracks, property] of [[data.rows, 'ActualHeight'], [data.columns, 'ActualWidth']]) {
      for (const track of tracks) {
        const definition = track.id ? context.resolve(track.id) : null;
        if (definition) definition.properties[property] = track.actual;
      }
    }
  }
};
