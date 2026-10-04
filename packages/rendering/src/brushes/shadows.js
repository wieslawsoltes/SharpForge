import {finite} from '../drawing/commands.js';
import {parseColor} from '../media/colors.js';

/** Shadow dimensions and offsets are logical DIPs. Colors remain straight sRGB until raster blending. */
export function normalizeShadow(value) {
  if (!value) return null;
  const properties = value.properties ?? value;
  const offset = properties.offset ?? properties.Offset ?? [0, 0, 0];
  return {kind: 'drop-shadow', blurRadius: finite(properties.blurRadius ?? properties.BlurRadius ?? 16, 'shadow blur', 0, 250),
    offset: [finite(offset[0] ?? offset.X ?? 0), finite(offset[1] ?? offset.Y ?? 0), finite(offset[2] ?? offset.Z ?? 0)],
    color: parseColor(properties.color ?? properties.Color ?? '#000000'),
    opacity: finite(properties.opacity ?? properties.Opacity ?? 1, 'shadow opacity', 0, 1),
    mask: properties.mask ?? properties.Mask ?? null};
}

/** Conservative three-sigma bounds include translated shadow pixels and the unchanged source. */
export function shadowBounds(bounds, input) {
  const shadow = normalizeShadow(input);
  if (!shadow || !shadow.opacity) return [...bounds];
  const blur = Math.ceil(shadow.blurRadius * 3), [x, y] = shadow.offset;
  const left = Math.min(bounds[0], bounds[0] + x - blur), top = Math.min(bounds[1], bounds[1] + y - blur);
  return [left, top, Math.max(bounds[0] + bounds[2], bounds[0] + bounds[2] + x + blur) - left,
    Math.max(bounds[1] + bounds[3], bounds[1] + bounds[3] + y + blur) - top];
}

/** Portable ThemeShadow material policy; native receiver/light goldens are a separate qualification tier. */
export function themeShadow(elevation, {theme = 'light'} = {}) {
  elevation = finite(elevation, 'shadow elevation', 0, 500);
  return normalizeShadow({blurRadius: elevation / 2, offset: [0, elevation / 4, 0],
    color: '#000000', opacity: elevation ? (theme === 'dark' ? 0.4 : 0.24) : 0});
}
