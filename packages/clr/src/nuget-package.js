import { readZip } from '@sharpforge/archive';
import { selectNugetAssets } from './nuget-assets.js';
import { checkCancellation, loadError, LoadErrorCode } from './load-errors.js';

/** Read a bounded in-memory nupkg and return selected immutable asset records; never writes to disk. */
export function selectNugetPackage(input, options = {}) {
  checkCancellation(options.signal);
  let entries;
  try { entries = readZip(input); }
  catch (error) { throw loadError(LoadErrorCode.InvalidImage, `Invalid NuGet package: ${error.message}`); }
  checkCancellation(options.signal);
  const files = new Map(entries.filter(entry => !entry.directory).map(entry => [entry.path, entry.bytes]));
  const selection = selectNugetAssets([...files.keys()], options);
  return Object.freeze({ ...selection,
    assets: Object.freeze(selection.paths.map(path => Object.freeze({ path, bytes: files.get(path) }))),
  });
}
