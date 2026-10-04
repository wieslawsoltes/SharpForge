import { finite, clamp, GridUnitType, LayoutError } from './geometry.js';

/** Normalize serialized GridLength definitions without consulting CSS tracks. */
export function createTracks(definitions, axis) {
  const values = definitions.length ? definitions : [{ properties: {} }];
  return values.map(definition => {
    const properties = definition.properties ?? definition;
    const length = properties[axis];
    const unit = length?.GridUnitType ?? GridUnitType.Star;
    const weight = finite(length?.Value, 1);
    const minimum = Math.max(0, finite(properties['Min' + axis]));
    const maximum = Math.max(minimum, finite(properties['Max' + axis], Infinity));
    if (![0, 1, 2].includes(unit) || weight < 0) throw new LayoutError('SFUI1620', 'Invalid GridLength definition');
    const base = unit === GridUnitType.Pixel ? clamp(weight, minimum, maximum) : minimum;
    return { id: definition.id, unit, weight, minimum, maximum, base, actual: base,
      sharedGroup: properties.SharedSizeGroup ?? null };
  });
}

/** Water filling resolves min/max saturation in O(tracks²), independent of item count. */
export function resolveTracks(tracks, available, spacing = 0) {
  let remainder = available - spacing * Math.max(0, tracks.length - 1);
  const stars = [];
  for (const track of tracks) {
    track.actual = track.base;
    if (track.unit === GridUnitType.Star && Number.isFinite(available)) stars.push(track);
    else remainder -= track.base;
  }
  if (!stars.length) return tracks;
  let active = stars;
  while (active.length) {
    const weight = active.reduce((sum, track) => sum + track.weight, 0);
    const next = [];
    let saturated = false;
    for (const track of active) {
      const allocated = weight > 0 ? Math.max(0, remainder) * track.weight / weight : 0;
      if (allocated < track.base || allocated > track.maximum || track.weight === 0) {
        track.actual = clamp(allocated, track.base, track.maximum);
        remainder -= track.actual;
        saturated = true;
      } else next.push(track);
    }
    if (!saturated) {
      for (const track of next) track.actual = Math.max(0, remainder) * track.weight / weight;
      break;
    }
    active = next;
  }
  return tracks;
}

export function trackExtent(tracks, start, span, spacing, field = 'actual') {
  let value = spacing * Math.max(0, span - 1);
  for (let index = start; index < start + span; index++) value += tracks[index][field];
  return value;
}

export function trackPositions(tracks, spacing, origin = 0) {
  const positions = [origin];
  for (let index = 0; index < tracks.length; index++) {
    positions.push(positions[index] + tracks[index].actual + (index < tracks.length - 1 ? spacing : 0));
  }
  return positions;
}
