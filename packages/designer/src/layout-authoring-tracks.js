import {track} from './model.js';
import {geometryInvariant} from './geometry-coordinates.js';

function axisProperties(axis) {
  geometryInvariant(['rows', 'columns'].includes(axis), 'SFD_TRACK_AXIS', 'Grid axis must be rows or columns.');
  return axis === 'rows' ? ['Row', 'RowSpan'] : ['Column', 'ColumnSpan'];
}

function validatedGrid(document, id, axis) {
  axisProperties(axis);
  const node = document.nodes.find(item => item.id === id);
  geometryInvariant(node?.type.endsWith('.Grid'), 'SFD_TRACK_PARENT', 'Track editing requires a Grid.');
  node[axis] = (node[axis]?.length ? node[axis] : ['*']).map(track);
  return node;
}

/** Insert/delete remap occupied intervals; reorder rejects spans that would become discontiguous. */
export function editGridTracks(document, {id, axis, action, index, value = '*', destination = null}) {
  const [position, span] = axisProperties(axis);
  return document.change(`Grid ${axis}: ${action}`, candidate => {
    const grid = validatedGrid(candidate, id, axis);
    const tracks = grid[axis];
    const inserted = action === 'insert';
    geometryInvariant(Number.isInteger(index) && index >= 0 && index < tracks.length + Number(inserted),
      'SFD_TRACK_INDEX', 'Grid track index is outside the track collection.');
    const childIds = new Set(grid.children);
    const children = new Map(candidate.nodes.filter(node => childIds.has(node.id)).map(node => [node.id, node]));
    if (action === 'insert' || action === 'split') {
      geometryInvariant(tracks.length < 64, 'SFD_TRACK_LIMIT', 'A Grid supports at most 64 tracks per axis.');
      const insertion = action === 'split' ? index + 1 : index;
      if (action === 'split') {
        geometryInvariant(tracks[index].GridUnitType !== 0, 'SFD_TRACK_SPLIT_AUTO', 'Choose Pixel or Star before splitting an Auto track.');
        const half = {...tracks[index], Value: tracks[index].Value / 2};
        tracks[index] = half;
        tracks.splice(insertion, 0, {...half});
      } else tracks.splice(insertion, 0, track(value));
      for (const child of children.values()) {
        const start = child.properties[position] ?? 0;
        const count = child.properties[span] ?? 1;
        if (start >= insertion) child.properties[position] = start + 1;
        else if (start + count > insertion || action === 'split' && start + count === insertion) child.properties[span] = count + 1;
      }
      return;
    }
    if (action === 'remove') {
      geometryInvariant(tracks.length > 1, 'SFD_TRACK_LAST', 'The last Grid track cannot be removed.');
      tracks.splice(index, 1);
      for (const child of children.values()) {
        const start = child.properties[position] ?? 0;
        const count = child.properties[span] ?? 1;
        child.properties[position] = Math.min(tracks.length - 1, start > index ? start - 1 : start);
        if (start <= index && start + count > index) child.properties[span] = Math.max(1, count - 1);
      }
      return;
    }
    if (action === 'size') {
      tracks[index] = track(value);
      return;
    }
    geometryInvariant(action === 'reorder', 'SFD_TRACK_ACTION', 'Unknown Grid track command.');
    geometryInvariant(Number.isInteger(destination) && destination >= 0 && destination < tracks.length,
      'SFD_TRACK_DESTINATION', 'Grid destination is outside the track collection.');
    const order = tracks.map((_, offset) => offset);
    order.splice(destination, 0, order.splice(index, 1)[0]);
    const positions = new Map(order.map((old, offset) => [old, offset]));
    for (const child of children.values()) {
      const start = child.properties[position] ?? 0;
      const count = child.properties[span] ?? 1;
      const occupied = Array.from({length: Math.min(count, tracks.length - start)}, (_, offset) => positions.get(start + offset));
      occupied.sort((left, right) => left - right);
      geometryInvariant(occupied.every((entry, offset) => entry === occupied[0] + offset),
        'SFD_TRACK_DISCONTIGUOUS', 'Reordering would split a spanning child across nonadjacent tracks.');
      child.properties[position] = occupied[0] ?? Math.min(start, tracks.length - 1);
    }
    grid[axis] = order.map(old => tracks[old]);
  });
}

/** Resize adjacent measured tracks. Star pairs keep their combined weight; mixed tracks become pixels. */
export function resizeGridTracks(document, {id, axis, index, sizes, delta, expectedRevision = document.revision}) {
  geometryInvariant(sizes.every(size => Number.isFinite(size) && size >= 0) && Number.isFinite(delta),
    'SFD_TRACK_MEASUREMENT', 'Track resize requires finite measured sizes.');
  geometryInvariant(Number.isInteger(index) && index >= 0 && index + 1 < sizes.length,
    'SFD_TRACK_BOUNDARY', 'Select an internal Grid boundary.');
  const left = Math.max(0, Math.min(sizes[index] + sizes[index + 1], sizes[index] + delta));
  const right = sizes[index] + sizes[index + 1] - left;
  return document.change('Resize adjacent Grid tracks', candidate => {
    const grid = validatedGrid(candidate, id, axis);
    geometryInvariant(grid[axis].length === sizes.length, 'SFD_TRACK_STALE', 'Grid measurements are stale.');
    const first = grid[axis][index];
    const second = grid[axis][index + 1];
    if (first.GridUnitType === 2 && second.GridUnitType === 2 && left + right > 0) {
      const weight = first.Value + second.Value;
      grid[axis][index] = track(`${weight * left / (left + right)}*`);
      grid[axis][index + 1] = track(`${weight * right / (left + right)}*`);
    } else {
      grid[axis][index] = track(left);
      grid[axis][index + 1] = track(right);
    }
  }, {expectedRevision});
}

/** Pure track resolution for fixed measures. Auto desired sizes must come from the runtime measure pass. */
export function resolveGridTracks(tracks, available, {spacing = 0, autoSizes = []} = {}) {
  geometryInvariant(Number.isFinite(available) && available >= 0 && spacing >= 0,
    'SFD_TRACK_AVAILABLE', 'Track space must be finite and nonnegative.');
  const values = tracks.map(track);
  const sizes = values.map((value, index) => value.GridUnitType === 1 ? value.Value
    : value.GridUnitType === 0 ? Math.max(0, autoSizes[index] ?? 0) : 0);
  const remaining = Math.max(0, available - sizes.reduce((sum, size) => sum + size, 0) - Math.max(0, sizes.length - 1) * spacing);
  const weight = values.reduce((sum, value) => sum + (value.GridUnitType === 2 ? value.Value : 0), 0);
  return sizes.map((size, index) => values[index].GridUnitType === 2 && weight ? remaining * values[index].Value / weight : size);
}
