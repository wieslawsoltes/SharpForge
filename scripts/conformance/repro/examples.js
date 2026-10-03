import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { temporary, inventory, differences, run, cli, isMain, revision, git } from './common.js';
import { createSourceArchive, extractSource } from './source.js';
import { vendorCache, verifyCache } from './cache.js';
import { npmCli } from '../node-tools.js';
import { cp } from 'node:fs/promises';

export const generators = Object.freeze([
  'scripts/build-managed-examples.js',
  'scripts/build-release10-examples.js',
  'scripts/build-template-examples.js',
  'scripts/build-designer-examples.js',
  'scripts/build-release13-examples.js',
  'scripts/build-release14-examples.js',
]);
export async function regenerate(root, order, { signal, execute = run } = {}) {
  for (const script of order)
    await execute(process.execPath, [script], {
      cwd: root,
      signal,
      env: { ...process.env, TZ: 'UTC', LC_ALL: 'C', npm_config_offline: 'true' },
    });
  return inventory(join(root, 'examples'));
}
export function compareExamples(committed, forward, reverse) {
  const stale = differences(committed, forward),
    orderDependent = differences(forward, reverse);
  return { passed: !stale.length && !orderDependent.length, stale, orderDependent };
}
export async function verifyExamples({ root = process.cwd(), ref = 'HEAD', archive, cache, signal } = {}) {
  root = resolve(root);
  return temporary(async (temporaryRoot) => {
    const source = archive
      ? { ...(await revision(root, ref)), archive: resolve(archive) }
      : await createSourceArchive({ root, ref, output: join(temporaryRoot, 'source.zip'), signal });
    const results = [];
    let committed;
    for (let index = 0; index < 2; index++) {
      const tree = join(temporaryRoot, `examples-${index}`);
      await extractSource({ ...source, root, destination: tree, reverse: !!index, signal });
      if (index === 0) committed = await inventory(join(tree, 'examples'));
      const selectedCache = cache ? resolve(cache) : join(temporaryRoot, 'cache');
      if (!cache && index === 0) await vendorCache({ root: tree, output: selectedCache, signal });
      await verifyCache(tree, selectedCache);
      const privateCache = join(tree, '.repro-npm-cache');
      await cp(join(selectedCache, 'cache'), privateCache, { recursive: true });
      await run(
        process.execPath,
        [npmCli(), 'ci', '--offline', '--ignore-scripts', '--cache', privateCache, '--no-audit', '--no-fund'],
        { cwd: tree, signal },
      );
      results.push(await regenerate(tree, index ? [...generators].reverse() : generators, { signal }));
    }
    return {
      schemaVersion: 1,
      commit: source.commit,
      harnessCommit: await git(root, ['rev-parse', 'HEAD']),
      harnessDirty: !!(await git(root, ['status', '--porcelain'])),
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
      generators: [...generators],
      ...compareExamples(committed, ...results),
      files: committed.length,
      scope: 'Exact committed examples regenerated in independent temporary trees in both generator orders.',
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
    },
  });
  await cli((signal) => verifyExamples({ ...values, signal }), {
    report: 'artifacts/results/repro/examples.json',
  });
}
