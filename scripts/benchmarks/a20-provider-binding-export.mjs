import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, copyFileSync, symlinkSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const [revision, requestedDestination] = process.argv.slice(2);
if (!/^[0-9a-f]{40}$/.test(revision ?? '') || !requestedDestination || process.argv.length !== 4) {
  throw new Error('Usage: a20-provider-binding-export.mjs FULL_COMMIT_SHA NEW_DESTINATION');
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const destination = resolve(requestedDestination);
const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}).trim();

function packagesAt(commit) {
  const pending = ['compiler'];
  const packages = new Map();
  while (pending.length) {
    const name = pending.pop();
    if (packages.has(name)) continue;
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid source package name');
    const manifest = JSON.parse(git(['show', `${commit}:packages/${name}/package.json`]));
    if (manifest.name !== `@sharpforge/${name}`) throw new Error(`Mismatched package identity: ${name}`);
    packages.set(name, manifest);
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (!dependency.startsWith('@sharpforge/')) throw new Error(`Benchmark export requires an external dependency: ${dependency}`);
      pending.push(dependency.slice('@sharpforge/'.length));
    }
  }
  return [...packages.keys()].sort();
}

function sourceInventory(commit, paths) {
  const rows = git(['ls-tree', '-r', '-l', commit, '--', ...paths]).split('\n');
  let bytes = 0;
  for (const row of rows) {
    const match = row.match(/^100(?:644|755) blob [0-9a-f]+\s+(\d+)\t/);
    if (!match) throw new Error('Source export requires ordinary Git files; symlink or submodule found');
    bytes += Number(match[1]);
  }
  return {files: rows.length, bytes};
}

function main() {
  const resolved = git(['rev-parse', '--verify', `${revision}^{commit}`]);
  if (resolved !== revision) throw new Error('Commit identity does not match the requested snapshot');
  if (existsSync(destination)) throw new Error('Destination already exists; choose a new directory');
  const packages = packagesAt(revision);
  const paths = packages.flatMap(name => [`packages/${name}/package.json`, `packages/${name}/src`]);
  const inventory = sourceInventory(revision, paths);
  // Archive stays in bounded memory; no duplicate tar file or full Git worktree is created.
  const archive = execFileSync('git', ['archive', '--format=tar', revision, '--', ...paths],
    {cwd: root, maxBuffer: 128 * 1024 * 1024});
  mkdirSync(destination, {recursive: true});
  execFileSync('tar', ['-xf', '-', '-C', destination], {input: archive, maxBuffer: 1024 * 1024});
  const scope = join(destination, 'node_modules', '@sharpforge');
  mkdirSync(scope, {recursive: true});
  for (const name of packages) symlinkSync(join(destination, 'packages', name), join(scope, name),
    process.platform === 'win32' ? 'junction' : 'dir');
  const benchmark = new URL('./a20-provider-binding.mjs', import.meta.url);
  const benchmarkSha256 = createHash('sha256').update(readFileSync(benchmark)).digest('hex');
  copyFileSync(benchmark, join(destination, 'a20-provider-binding.mjs'));
  writeFileSync(join(destination, 'package.json'), JSON.stringify({name: 'sharpforge-provider-benchmark-snapshot',
    private: true, type: 'module'}) + '\n', {flag: 'wx'});
  const info = {schemaVersion: 1, revision, packages, inventory, benchmarkSha256};
  writeFileSync(join(destination, 'a20-provider-binding-export.json'), JSON.stringify(info, null, 2) + '\n', {flag: 'wx'});
  process.stdout.write(JSON.stringify({destination, ...info}, null, 2) + '\n');
}

main();
