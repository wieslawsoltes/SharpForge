import {createHash} from 'node:crypto';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function releaseManifest(directory, commit) {
  const entries = await readdir(directory, {withFileTypes: true});
  const names = entries.filter(entry => entry.isFile() && /\.(?:tgz|zip|html)$/.test(entry.name)).map(entry => entry.name).sort();
  if (!names.length) throw new Error('No release payloads found');
  const files = [];
  for (const name of names) {
    const bytes = await readFile(join(directory, name));
    files.push({path: name, bytes: bytes.length, sha256: sha256(bytes)});
  }
  return {schemaVersion: 1, algorithm: 'SHA256', commit,
    scope: 'Release payload files alongside this manifest. Historical tracked docs and workspace files are not release qualification evidence.', files};
}

export async function verifyManifest(directory, manifest) {
  const actual = await releaseManifest(directory, manifest.commit);
  if (JSON.stringify(actual) !== JSON.stringify(manifest)) throw new Error('Release payload inventory or content differs from SOURCE-MANIFEST.json');
  return actual;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, destination = 'artifacts'] = process.argv.slice(2), directory = resolve(destination);
  const target = join(directory, 'SOURCE-MANIFEST.json');
  if (mode === '--generate') {
    const git = spawnSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'});
    if (git.status !== 0) throw new Error(git.stderr);
    const manifest = await releaseManifest(directory, git.stdout.trim());
    await writeFile(target, JSON.stringify(manifest, null, 2) + '\n');
    const sums = [...manifest.files, {path: 'SOURCE-MANIFEST.json', sha256: sha256(await readFile(target))}];
    await writeFile(join(directory, 'SHA256SUMS'), sums.map(file => `${file.sha256}  ${file.path}`).join('\n') + '\n');
  } else if (mode === '--verify') {
    const manifest = await verifyManifest(directory, JSON.parse(await readFile(target, 'utf8')));
    const sums = [...manifest.files, {path: 'SOURCE-MANIFEST.json', sha256: sha256(await readFile(target))}];
    if (await readFile(join(directory, 'SHA256SUMS'), 'utf8') !== sums.map(file => `${file.sha256}  ${file.path}`).join('\n') + '\n') throw new Error('SHA256SUMS differs from verified release payloads');
  } else throw new Error('Usage: source-manifest.js --generate|--verify [artifact directory]');
}
