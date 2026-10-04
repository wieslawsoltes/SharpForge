import {copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {hash, stable} from './evidence.js';

function inventory(directory) {
  return readdirSync(directory).sort().map(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? {name, kind: 'directory-link', source: realpathSync(path)}
      : {name, kind: 'file-copy', sha256: hash(readFileSync(path))};
  });
}

/** A real directory preserves the repository's node_modules/ ignore rule, which does not match a symlink. */
export function linkReferenceDependencies(product, reference) {
  const source = resolve(product, 'node_modules'), destination = resolve(reference, 'node_modules');
  if (!existsSync(source)) return null;
  if (existsSync(destination)) throw new Error('Reference dependency directory already exists');
  const entries = inventory(source);
  mkdirSync(destination);
  for (const entry of entries) {
    const from = join(source, entry.name), to = join(destination, entry.name);
    if (entry.kind === 'directory-link') symlinkSync(from, to, process.platform === 'win32' ? 'junction' : 'dir');
    else copyFileSync(from, to);
  }
  return {source, strategy: 'real-directory-with-product-entry-links', entries};
}

/** Runtime code still loads through the explicit reference entrypoint; only unchanged public dependencies are shared. */
export function verifyReferenceDependencies(product, reference, recorded) {
  const source = resolve(product, 'node_modules'), destination = resolve(reference, 'node_modules');
  if (recorded === null && !existsSync(source) && !existsSync(destination)) return;
  if (!recorded || recorded.source !== source || recorded.strategy !== 'real-directory-with-product-entry-links' ||
      !lstatSync(destination).isDirectory() || lstatSync(destination).isSymbolicLink() ||
      stable(recorded.entries) !== stable(inventory(source)) ||
      stable(readdirSync(destination).sort()) !== stable(recorded.entries.map(entry => entry.name))) {
    throw new Error('Profiler reference dependency provenance changed');
  }
  for (const entry of recorded.entries) {
    const path = join(destination, entry.name);
    const valid = entry.kind === 'directory-link' ? lstatSync(path).isSymbolicLink() && realpathSync(path) === entry.source
      : lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && hash(readFileSync(path)) === entry.sha256;
    if (!valid) throw new Error('Profiler reference dependency differs: ' + entry.name);
  }
}
