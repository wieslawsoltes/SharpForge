/** Resolve typed FontFamily descriptors without changing the released string property ABI. */
export function layoutFontFamily(properties, resolve = () => null, fallback = 'Segoe UI Variable, Segoe UI, system-ui, sans-serif') {
  const value = properties.FontFamilyObject ?? properties.FontFamily;
  const descriptor = value?.$ref ? resolve(value.$ref) : value;
  return descriptor?.properties?.Source ?? descriptor?.Source ?? (typeof descriptor === 'string' ? descriptor : fallback);
}
