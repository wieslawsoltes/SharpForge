import { cp, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { build, assertToolchain } from '../repro/build.js';
import { vendorCache } from '../repro/cache.js';
import { compareBuilds } from '../repro/double-build.js';
import { sourceTree } from '../repro/source.js';
import {
  git,
  revision,
  temporary,
  run,
  writeJSON,
  readRegular,
  hash,
  isMain,
} from '../repro/common.js';
import { root as harness, within } from './scenario.js';

/** Exact commit and credential-free clone source; a local path is also supported. */
export function reproductionInputs({ repository, commit, operator }) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? ''))
    throw new Error('An exact 40-character commit is required');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(operator ?? ''))
    throw new Error('An operator identifier is required');
  if (
    typeof repository !== 'string' ||
    !repository ||
    repository.startsWith('-')
  )
    throw new Error('Invalid repository');
  if (repository.includes('://')) {
    const url = new URL(repository);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        'Use a credential-free HTTPS repository URL or local path',
      );
  } else if (repository.includes('\0') || /^[^/]+@[^/]+:/.test(repository)) {
    throw new Error('Use a credential-free HTTPS repository URL or local path');
  }
  return {
    repository: repository.includes('://') ? repository : resolve(repository),
    commit,
    operator,
  };
}

async function freshOutput(output) {
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
}

/** Build once in a new non-shared clone and retain every compared byte. No publication. */
export async function reproduce(options) {
  const { repository, commit, operator } = reproductionInputs(options);
  const output = resolve(options.output);
  await freshOutput(output);
  const report = {
    schemaVersion: 1,
    kind: 'clean-clone-release',
    status: 'running',
    runId: randomUUID(),
    operator,
    commit,
    platform: `${process.platform}-${process.arch}`,
  };
  await writeJSON(join(output, 'report.json'), report);
  try {
    report.harnessCommit = await git(harness, ['rev-parse', 'HEAD']);
    if (commit !== report.harnessCommit)
      throw new Error('Run the harness from the exact commit being reproduced');
    await assertToolchain(harness);
    await temporary(async (directory) => {
      const tree = join(directory, 'source');
      await run(
        'git',
        ['clone', '--no-local', '--no-checkout', '--', repository, tree],
        { signal: options.signal },
      );
      await git(tree, ['checkout', '--detach', commit], {
        signal: options.signal,
      });
      const source = await revision(tree);
      if (
        source.commit !== commit ||
        (await git(tree, ['status', '--porcelain']))
      )
        throw new Error('Clone is not clean at requested commit');
      report.sourceTreeSha256 = hash(
        JSON.stringify([...(await sourceTree(tree, commit))]),
      );
      const cache = join(directory, 'cache');
      await vendorCache({ root: tree, output: cache, signal: options.signal });
      report.build = await build({
        root: tree,
        ...source,
        cache,
        signal: options.signal,
      });
      if (
        (await git(tree, ['rev-parse', 'HEAD'])) !== commit ||
        (await git(tree, ['status', '--porcelain']))
      )
        throw new Error('Source checkout changed during reproduction');
      for (const row of report.build.outputs) {
        const destination = within(join(output, 'outputs'), row.path);
        await mkdir(dirname(destination), { recursive: true });
        await cp(within(tree, row.path), destination, {
          errorOnExist: true,
          force: false,
        });
      }
    });
    if (
      (await git(harness, ['rev-parse', 'HEAD'])) !== commit ||
      (await git(harness, ['status', '--porcelain']))
    )
      throw new Error('Harness checkout changed during reproduction');
    report.status = 'passed';
  } catch (error) {
    report.status = options.signal?.aborted ? 'cancelled' : 'failed';
    report.error = error.message;
  }
  await writeJSON(join(output, 'report.json'), report);
  return report;
}

/** Reject incomplete/duplicate captures before comparing independently retained bytes. */
export function compareCaptures(first, second) {
  for (const report of [first, second]) {
    if (
      report.schemaVersion !== 1 ||
      report.kind !== 'clean-clone-release' ||
      report.status !== 'passed' ||
      !/^[a-f0-9-]{36}$/.test(report.runId ?? '') ||
      !/^[a-f0-9]{64}$/.test(report.sourceTreeSha256 ?? '') ||
      !/^[a-f0-9]{40}$/.test(report.commit ?? '') ||
      report.harnessCommit !== report.commit ||
      report.build?.commit !== report.commit ||
      !report.build.outputs?.length ||
      !report.build.golden?.examples?.length ||
      !report.build.golden?.bundles?.length ||
      report.build.golden.algorithm !== 'sha256' ||
      !Number.isSafeInteger(report.build.epoch) ||
      report.build.epoch < 0
    )
      throw new Error('Incomplete clean-clone capture');
    reproductionInputs({
      repository: '.',
      commit: report.commit,
      operator: report.operator,
    });
    for (const row of report.build.outputs) {
      within(harness, row.path);
      if (
        !/^[a-f0-9]{64}$/.test(row.sha256) ||
        !Number.isSafeInteger(row.bytes) ||
        row.bytes < 0
      )
        throw new Error('Invalid output hash or length');
    }
  }
  if (first.runId === second.runId || first.operator === second.operator)
    throw new Error('Two distinct operator captures are required');
  if (first.sourceTreeSha256 !== second.sourceTreeSha256)
    throw new Error('Source trees differ');
  return compareBuilds(first.build, second.build);
}

async function readCapture(path) {
  const report = JSON.parse(
    await readRegular(path, { maxBytes: 32 * 1024 * 1024 }),
  );
  if (!Array.isArray(report.build?.outputs))
    throw new Error('Missing retained outputs');
  for (const row of report.build.outputs) {
    const bytes = await readRegular(
      within(join(dirname(path), 'outputs'), row.path),
    );
    if (bytes.length !== row.bytes || hash(bytes) !== row.sha256)
      throw new Error('Retained output differs: ' + row.path);
  }
  return report;
}
export async function compareReproductions({ first, second, output }) {
  output = resolve(output);
  await freshOutput(output);
  const report = {
    schemaVersion: 1,
    kind: 'independent-clone-comparison',
    status: 'failed',
  };
  try {
    const captures = await Promise.all(
      [first, second].map((path) => readCapture(resolve(path))),
    );
    report.comparison = compareCaptures(...captures);
    report.captures = captures.map((capture) => ({
      runId: capture.runId,
      operator: capture.operator,
      commit: capture.commit,
      platform: capture.platform,
    }));
    report.inputHashes = await Promise.all(
      [first, second].map(async (path) => hash(await readFile(path))),
    );
    report.status = report.comparison.passed ? 'passed' : 'failed';
    if (!report.comparison.passed)
      report.error =
        'Unrecorded release mismatch; investigate and add exact task/gap blockers';
  } catch (error) {
    report.error = error.message;
  }
  await writeJSON(join(output, 'comparison.json'), report);
  return report;
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      repository: { type: 'string' },
      commit: { type: 'string' },
      operator: { type: 'string' },
      output: { type: 'string' },
      first: { type: 'string' },
      second: { type: 'string' },
    },
  });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    if (!values.output) throw new Error('--output must name a new directory');
    if (!!values.first !== !!values.second)
      throw new Error('Provide both --first and --second');
    const report = values.first
      ? await compareReproductions(values)
      : await reproduce({ ...values, signal: controller.signal });
    console.log(JSON.stringify(report));
    process.exitCode = report.status === 'passed' ? 0 : 1;
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
