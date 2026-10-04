import {createHash} from 'node:crypto';
import {cssDeclarations, colorLiterals} from '../../scripts/quality/theme-colors.js';

const paintProperty = /^(?:background(?:-.*)?|border(?:-.*)?|outline(?:-.*)?|color|box-shadow|text-shadow|filter|caret-color|accent-color|fill|stroke)$/;
export const fingerprintDeclarations = records => createHash('sha256').update(JSON.stringify(records)).digest('hex');
const normalizedSelector = value => value.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim();

export function literalThemePalette(styles) {
  const palette = new Map();
  for (const style of styles) {
    for (const {property, value} of cssDeclarations(style)) {
      if (property.startsWith('--') && (colorLiterals(value).length || value === 'white')) palette.set(property, value);
    }
  }
  return palette;
}

export function expandThemeTokens(value, palette) {
  return value.replace(/var\((--[\w-]+)\)/g, (match, token) => palette.get(token) ?? match);
}

export function normalizedDeclarations(records, {palette = new Map(), declared = [], animations = []} = {}) {
  const known = new Set(declared), animated = new Set(animations), paint = [], other = [];
  for (const record of records) {
    let value = expandThemeTokens(record.value, palette);
    const customColor = record.property.startsWith('--') && colorLiterals(value).length > 0;
    const isPaint = paintProperty.test(record.property) || customColor || record.context.some(context => animated.has(context));
    value = value.replace(/var\(\s*(--[\w-]+)\s*,\s*(#[\da-f]{3,8})\s*\)/gi,
      (match, token) => known.has(token) ? `var(${token})` : match);
    value = value.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim();
    const normalized = [record.context.map(normalizedSelector), normalizedSelector(record.selector), record.property, value];
    (isPaint ? paint : other).push(normalized);
  }
  return {paint, other};
}

export function activeThemePalette(styles, theme, forced = false) {
  const palette = new Map();
  for (const style of styles) {
    for (const record of cssDeclarations(style)) {
      if (!record.property.startsWith('--')) continue;
      const forcedRule = record.context.some(context => context.includes('forced-colors: active'));
      if (forcedRule && !forced) continue;
      const selected = [...record.selector.matchAll(/\[data-theme=(?:"([^"]+)"|([^\]]+))\]/g)];
      if (selected.length && selected.every(match => (match[1] ?? match[2]) !== theme)) continue;
      palette.set(record.property, record.value);
    }
  }
  return palette;
}

export function resolveThemeToken(palette, token, visited = new Set()) {
  if (visited.has(token)) throw new Error(`Theme cycle: ${token}`);
  visited.add(token);
  const value = palette.get(token);
  if (value === undefined) throw new Error(`Missing theme token: ${token}`);
  return value.replace(/var\((--[\w-]+)\)/g, (match, reference) => resolveThemeToken(palette, reference, new Set(visited)));
}
