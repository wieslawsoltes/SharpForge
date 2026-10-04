import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { cpus, freemem, loadavg, release, totalmem } from 'node:os';
import { getHeapStatistics } from 'node:v8';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert(!entry.isSymbolicLink(), 'Benchmark package sources must not contain aliases: ' + path);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function sourceDigest(directory) {
  const files = sourceFiles(directory).sort();
  const digest = createHash('sha256');
  let bytes = 0;
  for (const file of files) {
    const content = readFileSync(file);
    const path = relative(directory, file).replaceAll('\\', '/');
    digest.update(`${path.length}:${path}\0${sha256(content)}\n`);
    bytes += content.length;
  }
  return { sha256: digest.digest('hex'), files: files.length, bytes,
    algorithm: 'SHA-256 of sorted relative-path length, path, NUL, content SHA-256 and LF records' };
}

/** Reject mixed-checkout package resolution and hash every source file in the declared workspace dependency closure. */
export async function symbolWorkspace(directory, { expectedCommit, compiler = false } = {}) {
  const root = realpathSync(resolve(directory));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim();
  const commit = git('rev-parse', 'HEAD');
  if (expectedCommit) {
    assert.equal(commit, git('rev-parse', '--verify', '--end-of-options', expectedCommit + '^{commit}'),
      'Unexpected benchmark baseline revision');
  }
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Benchmark checkout has modified tracked files');
  const packages = new Map();
  const rootRequire = createRequire(join(root, 'package.json'));
  function visit(name, entry) {
    const packageName = name.slice('@sharpforge/'.length);
    const packageRoot = join(root, 'packages', packageName);
    const expectedEntry = realpathSync(join(packageRoot, 'src/index.js'));
    assert.equal(expectedEntry, join(packageRoot, 'src/index.js'), `${name} source entry aliases another path`);
    const actualEntry = realpathSync(entry);
    assert.equal(actualEntry, expectedEntry, `${name} resolves outside its selected checkout`);
    if (packages.has(name)) return;
    const manifestBytes = readFileSync(join(packageRoot, 'package.json'));
    const manifest = JSON.parse(manifestBytes);
    assert.equal(manifest.name, name);
    packages.set(name, { name, entry: actualEntry, manifestSha256: sha256(manifestBytes), source: sourceDigest(join(packageRoot, 'src')) });
    const require = createRequire(actualEntry);
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      if (dependency.startsWith('@sharpforge/')) visit(dependency, require.resolve(dependency));
    }
  }
  for (const name of ['@sharpforge/symbols', '@sharpforge/cil', ...(compiler ? ['@sharpforge/compiler'] : [])]) {
    visit(name, rootRequire.resolve(name));
  }
  const symbols = await import(pathToFileURL(packages.get('@sharpforge/symbols').entry).href);
  const cil = await import(pathToFileURL(packages.get('@sharpforge/cil').entry).href);
  const compilerLibrary = compiler ? await import(pathToFileURL(packages.get('@sharpforge/compiler').entry).href) : null;
  return { symbols, cil, compiler: compilerLibrary,
    provenance: { root, commit, tree: git('rev-parse', 'HEAD^{tree}'), packages: [...packages.values()] } };
}

export function benchmarkSources(paths) {
  return paths.map((path) => ({ path: realpathSync(path), sha256: sha256(readFileSync(path)) }));
}

export function benchmarkEnvironment() {
  return { capturedAt: new Date().toISOString(), node: process.version, v8: process.versions.v8,
    platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytes: freemem(), loadAverage: loadavg(),
    heapLimitBytes: getHeapStatistics().heap_size_limit, gcExposed: typeof globalThis.gc === 'function', execArgv: process.execArgv };
}
