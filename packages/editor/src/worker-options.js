/** Worker hosts accept ordinary URLs; only generated closed bundles declare their format.
 * The standalone packager adds a nonwritable `workerType` field to its own URL objects.
 * Copying/stringifying a URL deliberately drops that private asset metadata.
 */
export function workerOptions(asset, options = {}) {
  const type = asset?.workerType ?? options.type ?? 'module';
  if (type !== 'module' && type !== 'classic') throw new TypeError('Worker format must be module or classic');
  return {...options, type};
}
