import { cleanEol } from './eol.js';

function lfsData(value) { return value.data ?? value; }

/** Shared cleaner: ordinary EOL conversion stays synchronous; approved adapters retain their awaited semantics. */
export function cleanWorktreeBytes(repo, path, bytes, options = {}) {
  repo.check(options);
  const settings = repo.eolOptions(path);
  const name = settings.attributes.filter;
  if (name === 'lfs' && (options.lfs ?? repo.lfs)) {
    const cleaned = (options.lfs ?? repo.lfs).clean(bytes, { path, ...options });
    return Promise.resolve(cleaned).then(lfsData);
  }
  const filter = typeof name === 'string' ? repo.policy.filter(name) : null;
  return filter?.clean
    ? Promise.resolve(filter.clean(bytes, { path, ...options })).then(cleaned => cleanEol(cleaned, settings)) : cleanEol(bytes, settings);
}
