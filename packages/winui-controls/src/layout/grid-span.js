import { trackExtent } from './grid-tracks.js';

/** Spans grow Auto tracks first, then star minima; fixed pixels never absorb content demand. */
export function distributeSpan(tracks, start, span, desired, spacing) {
  let remaining = desired - trackExtent(tracks, start, span, spacing, 'base');
  if (remaining <= 0) return false;
  let changed = false;
  for (const unit of [0, 2]) {
    let candidates = tracks.slice(start, start + span).filter(track => track.unit === unit && track.base < track.maximum);
    while (remaining > 1e-9 && candidates.length) {
      const share = remaining / candidates.length;
      const next = [];
      for (const track of candidates) {
        const added = Math.min(share, track.maximum - track.base);
        track.base += added;
        remaining -= added;
        changed ||= added > 0;
        if (track.base < track.maximum) next.push(track);
      }
      candidates = next;
    }
  }
  return changed;
}

export function gridCell(properties, rows, columns) {
  const row = Math.min(rows - 1, Math.max(0, Math.trunc(properties.Row ?? 0)));
  const column = Math.min(columns - 1, Math.max(0, Math.trunc(properties.Column ?? 0)));
  const rowSpan = Math.min(rows - row, Math.max(1, Math.trunc(properties.RowSpan ?? 1)));
  const columnSpan = Math.min(columns - column, Math.max(1, Math.trunc(properties.ColumnSpan ?? 1)));
  return { row, column, rowSpan, columnSpan };
}
