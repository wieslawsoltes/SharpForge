const fields = (value, lower, upper) => lower in value ? value[lower] : value[upper];

function vector(value, names) {
  const values = names.map(name => fields(value, name, name[0].toUpperCase() + name.slice(1)));
  return values.every(component => typeof component === 'number') ? values.join(',') : null;
}

/** Encode the immutable literal records accepted by convertXamlValue, including host Pascal-case value projections. */
export function writeXamlLiteralRecord(value) {
  if (!value || typeof value !== 'object') return null;
  if ('left' in value || 'Left' in value) return vector(value, ['left', 'top', 'right', 'bottom']);
  if ('topLeft' in value || 'TopLeft' in value) return vector(value, ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']);
  if ('unitType' in value || 'GridUnitType' in value) {
    const unit = fields(value, 'unitType', 'GridUnitType');
    const size = fields(value, 'value', 'Value');
    return unit === 'Auto' || unit === 0 ? 'Auto' : unit === 'Star' || unit === 2 ? size + '*' : String(size);
  }
  if ('weight' in value || 'Weight' in value) return String(fields(value, 'weight', 'Weight'));
  if (['A', 'R', 'G', 'B'].every(name => Number.isInteger(value[name]) && value[name] >= 0 && value[name] <= 255)) {
    return '#' + ['A', 'R', 'G', 'B'].map(name => value[name].toString(16).padStart(2, '0')).join('');
  }
  if ('x' in value || 'X' in value) {
    return 'width' in value || 'Width' in value ? vector(value, ['x', 'y', 'width', 'height']) : vector(value, ['x', 'y']);
  }
  if ('width' in value || 'Width' in value) return vector(value, ['width', 'height']);
  if (['Automatic', 'Forever'].includes(value.kind)) return value.kind;
  const ticks = value.ticks ?? value.Ticks ?? value.TimeSpan?.Ticks;
  if (ticks !== undefined) return formatTicks(ticks);
  if (typeof value.uri === 'string') return value.uri;
  return null;
}

function formatTicks(ticks) {
  let value = BigInt(ticks);
  const negative = value < 0n;
  if (negative) value = -value;
  const fraction = String(value % 10000000n).padStart(7, '0').replace(/0+$/, '');
  const seconds = value / 10000000n;
  const days = seconds / 86400n;
  const time = [seconds / 3600n % 24n, seconds / 60n % 60n, seconds % 60n].map(part => String(part).padStart(2, '0')).join(':');
  return (negative ? '-' : '') + (days ? days + '.' : '') + time + (fraction ? '.' + fraction : '');
}
