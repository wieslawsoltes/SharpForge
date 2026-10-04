import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile, writeFile, lstat, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join, dirname} from 'node:path';
import {files} from './repro/common.js';

export const buildIdentityPath = root => join(root, 'artifacts/results/build-identity/manifest.json');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Only revision/tree and cleanliness leave this function; no status paths or environment values are published. */
export function checkoutIdentity(root) {
  const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024});
  try {
    return {commit: git(['rev-parse', 'HEAD']).trim(), tree: git(['rev-parse', 'HEAD^{tree}']).trim(),
      clean: git(['status', '--porcelain', '--untracked-files=normal']).trim() === ''};
  } catch { return {commit: null, tree: null, clean: false}; }
}

export async function hashFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) throw new Error('Invalid build asset: ' + path);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > 64 * 1024 * 1024) throw new Error('Build asset exceeds 64 MiB');
    hash.update(chunk);
  }
  if (bytes !== info.size) throw new Error('Build asset changed while hashing');
  return {bytes, sha256: hash.digest('hex')};
}

export async function buildAssets(directory) {
  const assets = [];
  let total = 0;
  for (const path of await files(directory)) {
    const value = await hashFile(join(directory, path));
    total += value.bytes;
    if (total > 512 * 1024 * 1024) throw new Error('Build output exceeds identity inventory limit');
    assets.push({path, ...value});
  }
  if (!assets.some(asset => asset.path === 'index.html') || !assets.some(asset => asset.path === 'studio.js')) {
    throw new Error('Incomplete Studio build output');
  }
  return assets;
}

/** Written last outside release output, after all production asset transformations finish. */
export async function writeBuildIdentity(root, directory, sourceBefore = checkoutIdentity(root),
  {manifestPath = buildIdentityPath(root)} = {}) {
  const assets = await buildAssets(directory), sourceAfter = checkoutIdentity(root);
  const stable = JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter);
  const manifest = {format: 'sharpforge-build-identity', version: 1,
    source: {...sourceBefore, clean: sourceBefore.clean && stable}, stable,
    assetsSha256: sha256(JSON.stringify(assets)), assets};
  await mkdir(dirname(manifestPath), {recursive: true});
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export async function readBuildIdentity(root, directory, {manifestPath = buildIdentityPath(root)} = {}) {
  const path = manifestPath, info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) throw new Error('Invalid build identity manifest');
  const bytes = await readFile(path);
  const manifest = JSON.parse(bytes);
  if (manifest?.format !== 'sharpforge-build-identity' || manifest.version !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error('Missing completed build identity');
  }
  const assets = await buildAssets(directory);
  if (JSON.stringify(assets) !== JSON.stringify(manifest.assets) || sha256(JSON.stringify(assets)) !== manifest.assetsSha256) {
    throw new Error('Local production assets differ from the completed build');
  }
  return {manifest, bytes, sha256: sha256(bytes)};
}
