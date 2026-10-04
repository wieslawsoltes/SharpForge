import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, readFileSync, writeFileSync, renameSync, readdirSync, realpathSync, statSync} from 'node:fs';
import {join, relative, resolve, sep} from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024}).trim();
export const readJson = path => {
  if (statSync(path).size > 256 * 1024 * 1024) throw new RangeError('Report exceeds 256 MiB');
  return JSON.parse(readFileSync(path, 'utf8'));
};

export function writeJson(path, value) {
  const temporary = path + '.writing';
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  renameSync(temporary, path);
}

export function requireOutside(product, candidate) {
  const inside = relative(resolve(product), resolve(candidate));
  if (inside === '' || !inside.startsWith('..' + sep) && inside !== '..') {
    throw new Error('Evidence and reference directories must be outside the product');
  }
}

export function sourceIdentity(product, expectedCommit, dependencies = true) {
  const result = {commit: git(product, 'rev-parse', 'HEAD'), tree: git(product, 'rev-parse', 'HEAD^{tree}'),
    runtimeTree: git(product, 'rev-parse', 'HEAD:packages/runtime/src'),
    worktreeStatus: git(product, 'status', '--porcelain=v1', '--untracked-files=all'), packages: []};
  if (result.commit !== expectedCommit || result.worktreeStatus) throw new Error('Product revision or clean checkout differs');
  if (dependencies) {
    for (const entry of readdirSync(join(product, 'packages'), {withFileTypes: true})) {
      if (!entry.isDirectory()) continue;
      const packageRoot = join(product, 'packages', entry.name);
      const metadata = readJson(join(packageRoot, 'package.json'));
      const installed = realpathSync(join(product, 'node_modules', metadata.name));
      if (installed !== realpathSync(packageRoot)) throw new Error('Dependency escapes product: ' + metadata.name);
      result.packages.push({name: metadata.name, directory: installed});
    }
  }
  return result;
}

/** Retain byte hashes without loading large raw reports/traces into the orchestration heap. */
export async function artifactInventory(directory) {
  const files = [];
  for (const entry of readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
    if (['artifact-manifest.json', 'journal.json.writing'].includes(entry.name)) continue;
    if (!entry.isFile()) throw new Error('Unexpected non-file in evidence directory: ' + entry.name);
    const path = join(directory, entry.name);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    files.push({path: entry.name, bytes: statSync(path).size, sha256: hash.digest('hex')});
  }
  return files;
}

export function retainReference(directory, product, report) {
  if (report.format !== 'SharpForge.ProfilerReference/1' || report.status !== 'created' ||
      report.sourceCommit !== git(product, 'rev-parse', 'HEAD') || sha256(report.patch) !== report.patchSha256) {
    throw new Error('Reference manifest or full patch provenance differs');
  }
  writeFileSync(join(directory, 'profiler-reference.patch'), report.patch, {flag: 'wx'});
  writeFileSync(join(directory, 'profiler-reference.commit'),
    execFileSync('git', ['cat-file', 'commit', report.referenceCommit], {cwd: product}), {flag: 'wx'});
}
