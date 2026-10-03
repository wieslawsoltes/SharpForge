import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { npmCli } from '../node-tools.js';
import { hash, inventory, differences, readJSON, writeJSON, run, isMain } from './common.js';

export function dependencies(lock) {
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages)
    throw new Error('Requires npm lockfile version 2 or 3');
  const result = new Map();
  for (const entry of Object.values(lock.packages))
    if (entry.resolved && !entry.link) {
      if (
        !/^https:\/\//.test(entry.resolved) ||
        !/^sha(?:256|384|512)-[A-Za-z0-9+/]+=*$/.test(entry.integrity ?? '')
      )
        throw new Error('External dependency needs pinned HTTPS tarball and integrity');
      if (result.has(entry.resolved) && result.get(entry.resolved) !== entry.integrity)
        throw new Error('Conflicting dependency integrity');
      result.set(entry.resolved, entry.integrity);
    }
  return [...result].sort().map(([resolved, integrity]) => ({ resolved, integrity }));
}
export async function vendorCache({ root = process.cwd(), output, signal }) {
  root = resolve(root);
  output = resolve(output ?? join(root, 'artifacts/repro-cache'));
  // Exclusive creation: never erase an existing user cache or silently reuse it.
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  await mkdir(join(output, 'cache'));
  const lock = await readFile(join(root, 'package-lock.json')),
    entries = dependencies(JSON.parse(lock));
  for (const entry of entries)
    await run(
      process.execPath,
      [
        npmCli(),
        'cache',
        'add',
        entry.resolved,
        '--cache',
        join(output, 'cache'),
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ],
      { cwd: root, signal },
    );
  await rm(join(output, 'cache', '_logs'), { recursive: true, force: true });
  await rm(join(output, 'cache', '_update-notifier-last-checked'), { force: true });
  const manifest = {
    schemaVersion: 1,
    lockSha256: hash(lock),
    dependencies: entries,
    files: await inventory(join(output, 'cache')),
  };
  await writeJSON(join(output, 'cache-manifest.json'), manifest);
  return manifest;
}
export async function verifyCache(root, directory) {
  const manifest = await readJSON(join(directory, 'cache-manifest.json')),
    lock = await readFile(join(root, 'package-lock.json'));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.lockSha256 !== hash(lock) ||
    JSON.stringify(manifest.dependencies) !== JSON.stringify(dependencies(JSON.parse(lock)))
  )
    throw new Error('Vendored cache is not bound to this package lock');
  if (differences(manifest.files, await inventory(join(directory, 'cache'))).length)
    throw new Error('Vendored cache content differs from manifest');
  return manifest;
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: { root: { type: 'string', default: '.' }, output: { type: 'string' } },
  });
  console.log(JSON.stringify(await vendorCache(values)));
}
