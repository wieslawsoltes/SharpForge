import { cp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { npmCli } from '../node-tools.js';
import { releaseManifest, verifyManifest, verifyReleaseTree } from '../source-manifest.js';
import { goldenOutput } from '../../planning/golden-output.js';
import { packageRelease } from './package-release.js';
import { verifyCache } from './cache.js';
import { run, hash, writeJSON, git } from './common.js';

export async function build({ root, commit, epoch, cache, signal }) {
  const start = performance.now(),
    steps = [];
  await verifyCache(root, cache);
  const privateCache = join(root, 'artifacts/npm-cache');
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await cp(join(cache, 'cache'), privateCache, { recursive: true, errorOnExist: true, force: false });
  const env = {
    ...process.env,
    SOURCE_DATE_EPOCH: String(epoch),
    TZ: 'UTC',
    LC_ALL: 'C',
    npm_config_cache: privateCache,
    npm_config_offline: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    SHARPFORGE_RESULTS_DIR: join(root, 'artifacts/results'),
    SHARPFORGE_STANDALONE_PATH: join(root, 'artifacts/SharpForge-standalone.html'),
  };
  const commands = [
    [npmCli(), 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
    ['scripts/build.js'],
    ['scripts/standalone.js'],
    ['scripts/verify-packages.js'],
  ];
  for (const args of commands) {
    const result = await run(process.execPath, args, { cwd: root, env, signal });
    steps.push({
      command: [process.execPath, ...args],
      milliseconds: result.milliseconds,
      stdoutSha256: hash(result.stdout),
      stderr: result.stderr,
    });
  }
  await packageRelease({ root, epoch });
  const manifest = await releaseManifest(join(root, 'artifacts'), commit, { root });
  await writeJSON(join(root, 'artifacts/SOURCE-MANIFEST.json'), manifest);
  await verifyManifest(join(root, 'artifacts'), manifest);
  await verifyReleaseTree(root, manifest);
  // Reuse the A00 output contract for source/syntax/diagnostics and bytecode too.
  const golden = await goldenOutput({ root, build: false });
  return {
    schemaVersion: 1,
    commit,
    epoch,
    toolchain: {
      node: process.version,
      npm: (await run(process.execPath, [npmCli(), '--version'], { cwd: root, signal })).stdout.trim(),
    },
    outputs: [
      ...manifest.tree.files.map((file) => ({ ...file, path: 'dist/' + file.path })),
      ...manifest.files.map((file) => ({ ...file, path: 'artifacts/' + file.path })),
    ],
    golden,
    steps,
    milliseconds: performance.now() - start,
    manifest,
  };
}
export async function assertToolchain(root) {
  if (await git(root, ['status', '--porcelain']))
    throw new Error('Reproducibility harness must be committed with a clean checkout');
  const pin = JSON.parse(await readFile(join(root, 'planning/qualification/repro/toolchain.json'), 'utf8'));
  const actual = {
    node: process.version.slice(1),
    npm: (await run(process.execPath, [npmCli(), '--version'])).stdout.trim(),
  };
  if (pin.node !== actual.node || pin.npm !== actual.npm)
    throw new Error(
      `Reproducibility toolchain mismatch: expected ${JSON.stringify(pin)}, observed ${JSON.stringify(actual)}`,
    );
  return actual;
}
