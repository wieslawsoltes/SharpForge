import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { run, git } from '../repro/common.js';
import { corpus, root, json, sha256, main } from './shared/store.js';
export function summarize(rows, dimension) {
  const groups = {};
  for (const row of rows)
    for (const key of Array.isArray(row[dimension])
      ? row[dimension]
      : [row[dimension] ?? 'unclassified']) {
      const counts = (groups[key] ??= {
        pass: 0,
        fail: 0,
        unsupported: 0,
        unmeasured: 0,
      });
      counts[row.status]++;
    }
  for (const counts of Object.values(groups))
    counts.passRate =
      counts.pass + counts.fail
        ? counts.pass / (counts.pass + counts.fail)
        : null;
  return groups;
}
export function caseStatus(observations) {
  if (observations.some((row) => row.status === 'fail')) return 'fail';
  if (observations.some((row) => row.status === 'unsupported'))
    return 'unsupported';
  return observations.length &&
    observations.every((row) => row.status === 'pass')
    ? 'pass'
    : 'unmeasured';
}
export async function runSuite(
  suite,
  { output, maxCases = 100, timeoutMs = 45000, signal } = {},
) {
  if (!['roslyn', 'runtime-il', 'libraries', 'spec'].includes(suite))
    throw Error('Unknown suite');
  if (
    !Number.isSafeInteger(maxCases) ||
    maxCases < 1 ||
    maxCases > 10000 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120000
  )
    throw Error('Invalid case/time budget');
  const directory = path.join(corpus, suite),
    manifest = await json(path.join(directory, 'manifest.json')),
    rows = [];
  if (await git(root, ['status', '--porcelain']))
    throw Error('Suite execution requires a clean committed checkout');
  const commit = await git(root, ['rev-parse', 'HEAD']);
  for (const [index, entry] of manifest.entries.entries()) {
    if (!/^[a-z]+-[0-9a-f]{20}\.json$/.test(entry.file))
      throw Error('Invalid manifest filename');
    const file = path.join(directory, entry.file),
      bytes = await readFile(file);
    if (sha256(bytes) !== entry.sha256)
      throw Error('Fixture digest mismatch: ' + entry.file);
    const row = JSON.parse(bytes);
    if (sha256(row.sourceText) !== row.sourceSHA256)
      throw Error('Source digest mismatch');
    let observations = [];
    if (index < maxCases && !signal?.aborted) {
      try {
        const result = await run(
          process.execPath,
          [
            '--max-old-space-size=256',
            path.join(root, 'scripts/conformance/suites/shared/execute.js'),
            file,
            entry.sha256,
          ],
          {
            cwd: root,
            env: { ...process.env, DOTNET_GCHeapHardLimit: '0x10000000' },
            signal,
            timeout: timeoutMs,
            maxBytes: 2 * 1024 * 1024,
          },
        );
        observations = JSON.parse(result.stdout);
      } catch (error) {
        observations = [
          {
            engine: 'host',
            status: 'fail',
            error: error.message,
            cancelled: !!signal?.aborted,
          },
        ];
      }
    }
    rows.push({
      id: row.id,
      inputSHA256: entry.sha256,
      status: caseStatus(observations),
      reason: !observations.length
        ? signal?.aborted
          ? 'Cancelled before execution'
          : 'Case count budget; not executed'
        : undefined,
      langVersion: row.langVersion,
      namespace: row.namespace,
      featureId: row.featureId,
      opcodeFamilies:
        observations.find((value) => value.opcodeFamilies?.length)
          ?.opcodeFamilies ??
        (row.opcodeFamilies?.length ? row.opcodeFamilies : ['unclassified']),
      observations,
    });
  }
  if ((await git(root, ['rev-parse', 'HEAD'])) !== commit)
    throw Error('Checkout changed during suite execution');
  const report = {
    schemaVersion: 1,
    suite,
    commit: commit.trim(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    qualification: 'observations only; other platforms unmeasured',
    limits: {
      maxCases,
      timeoutMs,
      childV8HeapMiB: 256,
      managedHeapMiB: 16,
      maxInstructions: 2000000,
    },
    unavailableTargets: [
      {
        target: 'rust-native',
        reason:
          'A27 executable/artifact adapter is not available for this suite',
      },
      {
        target: 'rust-wasm',
        reason:
          'A27 executable/artifact adapter is not available for this suite',
      },
    ],
    total: rows.length,
    byLanguageVersion: summarize(rows, 'langVersion'),
    byNamespace: summarize(rows, 'namespace'),
    byOpcodeFamily: summarize(rows, 'opcodeFamilies'),
    byFeature: summarize(rows, 'featureId'),
    byEngine: summarize(
      rows.flatMap((row) =>
        row.observations.map((observation) => ({
          engine: observation.engine,
          status: observation.status,
        })),
      ),
      'engine',
    ),
    rows,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (main(import.meta.url)) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const report = await runSuite(process.argv[2], {
    output:
      process.argv[3] ??
      path.join(root, 'artifacts/suites', process.argv[2] + '.json'),
    maxCases: Number(process.argv[4] ?? 100),
    signal: controller.signal,
  });
  console.log(
    JSON.stringify({
      suite: report.suite,
      total: report.total,
      byLanguageVersion: report.byLanguageVersion,
    }),
  );
  process.exitCode = report.rows.some((row) => row.status === 'fail')
    ? 1
    : report.rows.some((row) => row.status !== 'pass')
      ? 2
      : 0;
}
