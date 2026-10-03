import { readFile, readlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { temporary, revision, differences, readJSON, cli, isMain, hash, git } from './common.js';
import { extractSource } from './source.js';
import { build, assertToolchain } from './build.js';
import { verifyManifest } from '../source-manifest.js';
import { verifyExamples } from './examples.js';

export function explain(changes, policy) {
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy.differences))
    throw new Error('Invalid committed explained-differences policy');
  const seen = new Set();
  for (const entry of policy.differences) {
    if (
      typeof entry.path !== 'string' ||
      seen.has(entry.path) ||
      !/^([a-f0-9]{64})$/.test(entry.expectedSha256 ?? '') ||
      !/^([a-f0-9]{64})$/.test(entry.actualSha256 ?? '') ||
      typeof entry.reason !== 'string' ||
      entry.reason.trim().length < 20 ||
      !/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(entry.issue ?? '')
    )
      throw new Error('Invalid, duplicate or unbounded explained difference');
    seen.add(entry.path);
  }
  const explained = [],
    unexplained = [];
  for (const change of changes) {
    const entry = policy.differences.find(
      (entry) =>
        entry.path === change.path &&
        entry.expectedSha256 === change.expected?.sha256 &&
        entry.actualSha256 === change.actual?.sha256,
    );
    (entry ? explained : unexplained).push({
      ...change,
      ...(entry ? { reason: entry.reason, issue: entry.issue } : {}),
    });
  }
  return { passed: !unexplained.length, explained, unexplained };
}
export async function networkIsolation() {
  if (process.platform !== 'linux')
    throw new Error('Kernel network-isolation qualification requires Linux unshare --net');
  const [self, host] = await Promise.all([readlink('/proc/self/ns/net'), readlink('/proc/1/ns/net')]);
  if (self === host) throw new Error('Offline qualification must run in a separate network namespace');
  // An isolated namespace cannot reach the network; assert that fact instead of
  // trusting an environment flag or silently falling back to npm offline mode.
  let reachable = false;
  try {
    await fetch('https://registry.npmjs.org/', { signal: AbortSignal.timeout(3000) });
    reachable = true;
  } catch {}
  if (reachable) throw new Error('Network egress unexpectedly succeeded in offline phase');
  return { kind: 'linux-network-namespace', namespace: self, hostNamespace: host, egress: 'blocked' };
}
export async function offline({
  root = process.cwd(),
  ref = 'HEAD',
  archive,
  cache,
  assets,
  requireNetworkIsolation = false,
  signal,
} = {}) {
  if (!archive || !cache || !assets)
    throw new Error('Exact source archive, vendored cache and release assets are required');
  root = resolve(root);
  archive = resolve(archive);
  cache = resolve(cache);
  assets = resolve(assets);
  await assertToolchain(root);
  const network = requireNetworkIsolation
    ? await networkIsolation()
    : { kind: 'npm-offline', kernelIsolation: 'not qualified on this invocation' };
  const source = await revision(root, ref),
    expected = await readJSON(join(assets, 'SOURCE-MANIFEST.json'));
  if (
    expected.commit !== source.commit ||
    expected.schemaVersion !== 2 ||
    expected.tree?.root !== 'dist' ||
    !expected.tree.files?.length
  )
    throw new Error('Release manifest must bind the exact source commit and nonempty dist tree');
  await verifyManifest(assets, expected);
  return temporary(async (directory) => {
    const tree = join(directory, 'source'),
      extracted = await extractSource({ archive, root, commit: source.commit, destination: tree, signal });
    const policyPath = join(tree, 'planning/qualification/repro/explained-differences.json'),
      policyBytes = await readFile(policyPath),
      policy = JSON.parse(policyBytes);
    const rebuilt = await build({ root: tree, commit: source.commit, epoch: source.epoch, cache, signal });
    const expectedOutputs = [
      ...expected.tree.files.map((row) => ({ ...row, path: 'dist/' + row.path })),
      ...expected.files.map((row) => ({ ...row, path: 'artifacts/' + row.path })),
    ];
    const comparison = explain(differences(expectedOutputs, rebuilt.outputs), policy);
    const examples = await verifyExamples({ root, ref: source.commit, archive, cache, signal });
    return {
      schemaVersion: 1,
      commit: source.commit,
      harnessCommit: await git(root, ['rev-parse', 'HEAD']),
      platform: `${process.platform}-${process.arch}`,
      toolchain: rebuilt.toolchain,
      network,
      sourceArchive: extracted,
      policy: {
        path: 'planning/qualification/repro/explained-differences.json',
        sha256: hash(policyBytes),
        content: policy,
      },
      ...comparison,
      examples,
      passed: comparison.passed && examples.passed,
      milliseconds: rebuilt.milliseconds,
      scope:
        'Exact source archive verified against Git blobs, npm ci --offline from a lock-bound vendored cache, ' +
        'standalone and all workspace package builds, regenerated examples and exact release asset comparison.',
    };
  });
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: '.' },
      ref: { type: 'string', default: 'HEAD' },
      archive: { type: 'string' },
      cache: { type: 'string' },
      assets: { type: 'string' },
      'require-network-isolation': { type: 'boolean' },
    },
  });
  await cli(
    (signal) => offline({ ...values, requireNetworkIsolation: values['require-network-isolation'], signal }),
    { report: 'artifacts/results/repro/offline.json' },
  );
}
