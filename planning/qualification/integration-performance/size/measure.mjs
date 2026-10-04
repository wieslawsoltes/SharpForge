import {lstat, readdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [target, output] = process.argv.slice(2);
const root = resolve(target);
const {loadBuildContributions} = await import(pathToFileURL(join(root, 'scripts/build-contributions.js')));
const {discoverPackages} = await import(pathToFileURL(join(root, 'scripts/verify-packages.js')));
async function bytes(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error('Artifact symlink: ' + path);
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) throw new Error('Unsupported artifact: ' + path);
  let total = 0;
  for (const name of (await readdir(path)).sort()) total += await bytes(join(path, name));
  return total;
}
const entries = [
  {id: 'dist', path: 'dist'},
  {id: 'standalone', path: 'artifacts/SharpForge-standalone.html'},
];
for (const worker of (await loadBuildContributions(root)).workers) {
  entries.push({id: 'worker:' + worker.entry, path: 'dist/' + worker.entry});
}
for (const pkg of await discoverPackages(root)) {
  const manifest = JSON.parse(await readFile(join(root, pkg.directory, 'package.json'), 'utf8'));
  const name = pkg.name.replace(/^@/, '').replaceAll('/', '-');
  entries.push({id: 'package:' + pkg.name, path: `artifacts/${name}-${manifest.version}.tgz`});
}
for (const entry of entries) entry.bytes = await bytes(join(root, entry.path));
await writeFile(output, JSON.stringify({schemaVersion: 1, artifacts: entries}, null, 2) + '\n');
