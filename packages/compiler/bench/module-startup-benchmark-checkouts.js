import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export const moduleStartupBaseline = 'fc4d9d994d93d75bac94131da62faa8fd13442d3';
const packageNames = ['compiler', 'runtime', 'cil'];
const git = (root, ...command) => execFileSync('git', ['-C', root, ...command], { encoding: 'utf8' }).trim();

function localEntry(root, require, name) {
  const packageName = name.split('/')[0];
  const packageRoot = realpathSync(join(root, 'packages', packageName));
  const alias = (require.resolve.paths('@sharpforge/' + packageName) ?? [])
    .map(directory => join(directory, '@sharpforge', packageName))
    .find(path => lstatSync(path, { throwIfNoEntry: false }));
  // Inspect the actual alias on each verification; Node may cache an earlier resolved real path.
  if (!alias || realpathSync(alias) !== packageRoot)
    throw new Error(`@sharpforge/${packageName} has no local workspace alias inside ${root}`);
  const entry = realpathSync(require.resolve('@sharpforge/' + name));
  const inside = relative(packageRoot, entry);
  if (inside.startsWith('..') || isAbsolute(inside))
    throw new Error(`@sharpforge/${name} resolves outside ${root}; create that checkout's own workspace aliases`);
  return entry;
}

function workspaceEntries(root) {
  const entries = new Map();
  const require = createRequire(join(root, 'packages/compiler/package.json'));
  const pending = packageNames.map(name => ({ name, require }));
  while (pending.length) {
    const { name, require: consumer } = pending.pop();
    const entry = localEntry(root, consumer, name);
    if (entries.has(name)) {
      if (entries.get(name) !== entry) throw new Error(`Workspace consumers resolve @sharpforge/${name} differently`);
      continue;
    }
    entries.set(name, entry);
    const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (dependency.startsWith('@sharpforge/'))
        pending.push({ name: dependency.slice('@sharpforge/'.length), require: createRequire(entry) });
    }
  }
  return entries;
}

/** Verify exact clean tracked source and transitive local aliases; an optional earlier snapshot must still match. */
export function verifyModuleStartupCheckout({ role, suppliedRoot, candidateSha, references }, previous = null) {
  const expectedSha = role === 'baseline' ? moduleStartupBaseline : candidateSha;
  if (!suppliedRoot || !/^[0-9a-f]{40}$/.test(expectedSha ?? ''))
    throw new Error(`--${role} must name a checkout; --candidate-sha must specify the exact full lowercase SHA`);
  const root = realpathSync(suppliedRoot);
  const revision = git(root, 'rev-parse', 'HEAD');
  if (revision !== expectedSha) throw new Error(`${role}: expected ${expectedSha}, found ${revision}`);
  if (git(root, 'status', '--porcelain', '--untracked-files=no')) throw new Error(`${role}: tracked files are modified`);
  const entries = workspaceEntries(root);
  const packageTrees = {};
  for (const name of entries.keys()) {
    const path = `HEAD:packages/${name}`;
    packageTrees[name] = {
      package: git(root, 'rev-parse', path), source: git(root, 'rev-parse', path + '/src'),
      manifest: git(root, 'rev-parse', path + '/package.json'),
    };
  }
  if (references === 'pack')
    entries.set('compiler/node', localEntry(root, createRequire(entries.get('compiler')), 'compiler/node'));
  const aliases = Object.fromEntries(entries);
  if (previous && (previous.root !== root || previous.revision !== revision
    || Object.keys(previous.aliases).length !== entries.size
    || [...entries].some(([name, entry]) => previous.aliases[name] !== entry)))
    throw new Error(`${role}: checkout or resolved workspace aliases changed after loading`);
  return { role, root, revision, packageTrees, aliases, entries };
}

/** Trusted developer checkouts only: import fixed public exports after verifying their exact source and aliases. */
export async function loadModuleStartupCheckout(options) {
  const { entries, ...checked } = verifyModuleStartupCheckout(options);
  const { references, role } = options;
  const variant = { ...checked, referenceLoadMs: null, pack: null };
  const exports = packageNames.map(name => ({ name, entry: entries.get(name) }));
  if (references === 'pack') exports.push({ name: 'compilerNode', entry: entries.get('compiler/node') });
  const started = performance.now();
  for (const { name, entry } of exports) variant[name] = await import(pathToFileURL(entry).href);
  variant.importMs = performance.now() - started;
  if (references === 'pack') {
    const referenceStarted = performance.now();
    variant.pack = variant.compilerNode.loadReferencePack();
    variant.referenceLoadMs = performance.now() - referenceStarted;
    if (!variant.pack) throw new Error(`${role}: no .NET reference pack; set DOTNET_ROOT or use --references registry`);
  }
  return variant;
}

/** Runtime/CIL changes are intentional: report their exact trees instead of rejecting the whole-revision comparison. */
export function moduleStartupCheckoutProvenance(variant) {
  return {
    role: variant.role, root: variant.root, revision: variant.revision, packageTrees: variant.packageTrees, aliases: variant.aliases,
    importMs: variant.importMs, referencePack: variant.pack?.pack.version ?? null, referenceLoadMs: variant.referenceLoadMs,
  };
}
