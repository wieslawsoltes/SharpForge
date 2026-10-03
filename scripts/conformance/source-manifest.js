import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inventory, differences, readRegular } from './repro/common.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function releaseManifest(directory, commit, { root } = {}) {
  if (!(await lstat(directory)).isDirectory()) throw new Error('Release directory must not be a symlink');
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() && /\.(?:tgz|zip|html)$/.test(entry.name)))
    throw new Error('Release payload must be a regular file, never a symlink');
  const names = entries
    .filter((entry) => entry.isFile() && /\.(?:tgz|zip|html)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (!names.length) throw new Error('No release payloads found');
  const files = [];
  for (const name of names) {
    const bytes = await readRegular(join(directory, name), { maxBytes: 512 * 1024 * 1024 });
    files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const manifest = {
    schemaVersion: 1,
    algorithm: 'SHA256',
    commit,
    scope:
      'Release payload files alongside this manifest. Historical tracked docs and workspace files are not release qualification evidence.',
    files,
  };
  if (root) {
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Release tree requires an exact source commit');
    const tree = await inventory(join(root, 'dist'));
    if (!tree.length) throw new Error('Release dist tree is empty');
    return {
      ...manifest,
      schemaVersion: 2,
      scope:
        'Exact release payloads and dist tree. Reports, caches and historical workspace documents are excluded.',
      tree: { root: 'dist', files: tree },
    };
  }
  return manifest;
}

// Payload-only API used by attestation and artifact-only publication stages.
// Complete build verification explicitly composes verifyReleaseTree below.
export async function verifyManifest(directory, manifest) {
  if (
    ![1, 2].includes(manifest?.schemaVersion) ||
    manifest.algorithm !== 'SHA256' ||
    typeof manifest.commit !== 'string' ||
    !Array.isArray(manifest.files)
  )
    throw new Error('Invalid source manifest');
  if (manifest.schemaVersion === 2 && !/^[a-f0-9]{40}$/.test(manifest.commit))
    throw new Error('Invalid source manifest commit');
  const actual = await releaseManifest(directory, manifest.commit);
  if (JSON.stringify(actual.files) !== JSON.stringify(manifest.files))
    throw new Error('Release payload inventory or content differs from SOURCE-MANIFEST.json');
  return manifest;
}
export async function verifyReleaseTree(root, manifest) {
  if (
    manifest.schemaVersion !== 2 ||
    manifest.tree?.root !== 'dist' ||
    !Array.isArray(manifest.tree.files) ||
    !manifest.tree.files.length
  )
    throw new Error('Manifest does not bind a release dist tree');
  const changed = differences(manifest.tree.files, await inventory(join(root, 'dist')));
  if (changed.length)
    throw new Error('Release dist tree differs: ' + changed.map((row) => row.path).join(', '));
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, destination = 'artifacts'] = process.argv.slice(2),
    directory = resolve(destination);
  const target = join(directory, 'SOURCE-MANIFEST.json');
  if (mode === '--generate') {
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (git.status !== 0) throw new Error(git.stderr);
    const manifest = await releaseManifest(directory, git.stdout.trim(), { root: process.cwd() });
    await writeFile(target, JSON.stringify(manifest, null, 2) + '\n');
    const sums = [
      ...manifest.files,
      { path: 'SOURCE-MANIFEST.json', sha256: sha256(await readFile(target)) },
    ];
    await writeFile(
      join(directory, 'SHA256SUMS'),
      sums.map((file) => `${file.sha256}  ${file.path}`).join('\n') + '\n',
    );
  } else if (mode === '--verify' || mode === '--verify-payloads') {
    const manifest = await verifyManifest(directory, JSON.parse(await readFile(target, 'utf8')));
    if (mode === '--verify') await verifyReleaseTree(process.cwd(), manifest);
    const sums = [
      ...manifest.files,
      { path: 'SOURCE-MANIFEST.json', sha256: sha256(await readFile(target)) },
    ];
    if (
      (await readFile(join(directory, 'SHA256SUMS'), 'utf8')) !==
      sums.map((file) => `${file.sha256}  ${file.path}`).join('\n') + '\n'
    )
      throw new Error('SHA256SUMS differs from verified release payloads');
  } else
    throw new Error('Usage: source-manifest.js --generate|--verify|--verify-payloads [artifact directory]');
}
