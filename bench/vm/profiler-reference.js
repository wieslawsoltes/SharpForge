import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, existsSync, symlinkSync, mkdirSync, statSync} from 'node:fs';
import {resolve, join, relative, sep, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {profilerReferenceChanges} from './profiler-reference-transform.js';
import {root, hash, stable, writeReport, isMain} from './evidence.js';

const runtimeDirectory = 'packages/runtime/src/';
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
const clean = cwd => git(cwd, 'status', '--porcelain=v1').trim() === '';
const revision = cwd => git(cwd, 'rev-parse', 'HEAD').trim();

function changesAt(directory) {
  const names = git(directory, 'ls-files', '-z', '--', runtimeDirectory).split('\0').filter(name => name.endsWith('.js'));
  return profilerReferenceChanges(names.map(name => [name.slice(runtimeDirectory.length), readFileSync(join(directory, name), 'utf8')]));
}

function recordedChanges(changes) {
  return changes.map(change => ({path: runtimeDirectory + change.path, before: hash(change.before),
    after: hash(change.after), edits: change.changes}));
}

function diff(directory, source, reference) {
  return git(directory, 'diff', '--no-ext-diff', '--binary', source, reference, '--', 'packages/runtime/src');
}

function sparsePatterns(directory) {
  const path = resolve(directory, git(directory, 'rev-parse', '--git-path', 'info/sparse-checkout').trim());
  return {path, patterns: existsSync(path) ? readFileSync(path, 'utf8') : null};
}

function checkoutReference(directory, sourceCommit, patterns) {
  if (patterns !== null) {
    git(directory, 'sparse-checkout', 'init', '--no-cone');
    const {path} = sparsePatterns(directory);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, patterns);
  }
  git(directory, 'read-tree', '-mu', sourceCommit);
}

/** Create a disposable committed reference, descended from exactly the measured product revision. Never changes the product checkout. */
export function createProfilerReference({directory, out}) {
  if (!clean(root)) throw new Error('Commit the product and harness before creating its profiler reference');
  const target = resolve(directory), output = resolve(out), sourceCommit = revision(root);
  if (existsSync(target)) throw new Error('Profiler reference directory must not exist: ' + target);
  if (target === root || relative(target, root).startsWith('..') === false) throw new Error('Reference directory cannot contain the product');
  if (output === target || !relative(target, output).startsWith('..' + sep)) {
    throw new Error('Reference manifest must be outside the disposable worktree');
  }
  const changes = changesAt(root);
  const patterns = sparsePatterns(root).patterns;
  let created = false;
  try {
    git(root, 'worktree', 'add', '--detach', '--no-checkout', target, sourceCommit);
    created = true;
    checkoutReference(target, sourceCommit, patterns);
    for (const change of changes) writeFileSync(join(target, runtimeDirectory, change.path), change.after);
    git(target, 'add', '--', ...changes.map(change => runtimeDirectory + change.path));
    git(target, '-c', 'commit.gpgsign=false', 'commit', '-m', 'SF-A05-T10.1: isolate a recorded profiler-hook-free measurement reference');
    if (existsSync(join(root, 'node_modules')) && !existsSync(join(target, 'node_modules'))) {
      symlinkSync(join(root, 'node_modules'), join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    }
    const referenceCommit = revision(target), patch = diff(target, sourceCommit, referenceCommit);
    if (!clean(target) || !clean(root) || revision(root) !== sourceCommit) throw new Error('Reference creation changed during recording');
    const manifest = {format: 'SharpForge.ProfilerReference/1', status: 'created', sourceCommit, referenceCommit,
      referenceDirectory: target, publicEntryPoint: 'packages/runtime/src/index.js', createdAt: new Date().toISOString(),
      command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)], changes: recordedChanges(changes),
      sparseCheckout: patterns === null ? null : {patterns, sha256: hash(patterns)},
      patch, patchSha256: hash(patch), transformSha256: hash(readFileSync(new URL('./profiler-reference-transform.js', import.meta.url))),
      scope: 'Removed reviewed profiling consumer hooks and initialization only; public getter returns null. ' +
        'Profiler exports remain loadable. Reference supports profiling off only; it is never a production candidate.'};
    writeReport(manifest, output);
    return manifest;
  } catch (error) {
    if (created) {
      try { git(root, 'worktree', 'remove', '--force', target); }
      catch (cleanup) { error.message += '; reference cleanup failed: ' + cleanup.message; }
    }
    throw error;
  }
}

/** Validate exact parent, complete patch, all changed files and clean working copies before importing the alternate public entrypoint. */
export async function loadProfilerReference(manifestPath) {
  const path = resolve(manifestPath), metadata = statSync(path);
  if (!metadata.isFile() || metadata.size > 1024 * 1024) throw new Error('Profiler reference manifest must be a file at most 1 MiB');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.format !== 'SharpForge.ProfilerReference/1' || manifest.status !== 'created' || !clean(root) ||
      manifest.sourceCommit !== revision(root)) throw new Error('Profiler reference does not match the clean product revision');
  const directory = resolve(manifest.referenceDirectory);
  if (directory === root || !clean(directory) || revision(directory) !== manifest.referenceCommit ||
      git(directory, 'rev-parse', 'HEAD^').trim() !== manifest.sourceCommit) throw new Error('Profiler reference revision or parent changed');
  if (manifest.sparseCheckout && (sparsePatterns(directory).patterns !== manifest.sparseCheckout.patterns ||
      hash(manifest.sparseCheckout.patterns) !== manifest.sparseCheckout.sha256)) throw new Error('Reference sparse patterns changed');
  const changes = changesAt(root), paths = changes.map(change => runtimeDirectory + change.path).sort();
  const changedPaths = git(directory, 'diff', '--name-only', manifest.sourceCommit, manifest.referenceCommit).trim().split('\n').sort();
  const patch = diff(directory, manifest.sourceCommit, manifest.referenceCommit);
  if (stable(paths) !== stable(changedPaths) || stable(recordedChanges(changes)) !== stable(manifest.changes) ||
      patch !== manifest.patch || hash(patch) !== manifest.patchSha256 ||
      hash(readFileSync(new URL('./profiler-reference-transform.js', import.meta.url))) !== manifest.transformSha256) {
    throw new Error('Profiler reference transformation or patch provenance changed');
  }
  for (const change of changes) {
    if (hash(readFileSync(join(directory, runtimeDirectory, change.path))) !== hash(change.after)) {
      throw new Error('Profiler reference file differs: ' + change.path);
    }
  }
  const api = await import(pathToFileURL(join(directory, 'packages/runtime/src/index.js')).href);
  return {api, manifest};
}

if (isMain(import.meta.url)) {
  try {
    const arguments_ = process.argv.slice(2), options = {};
    for (let index = 0; index < arguments_.length; index += 2) {
      const key = {'--dir': 'directory', '--out': 'out'}[arguments_[index]], value = arguments_[index + 1];
      if (!key || !value || value.startsWith('--') || options[key]) throw new Error('Use --dir NEW_WORKTREE --out MANIFEST');
      options[key] = value;
    }
    if (!options.directory || !options.out) throw new Error('Both --dir and --out are required');
    const manifest = createProfilerReference(options);
    process.stdout.write(`created ${manifest.referenceCommit}: ${resolve(options.out)}\n`);
  } catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }
}
