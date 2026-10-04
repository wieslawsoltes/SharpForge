import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { gitAvailability, fixtureWorkspace } from './native.js';
import { ConformanceReport } from './report.js';
import { runHistoryConformance } from './history.js';
import { runCLIConformance } from './cli.js';
import { runIntegrityConformance } from './integrity.js';

async function runCLIFormat(report, algorithm) {
  const workspace = await fixtureWorkspace(`sharpforge-cli-${algorithm}-`);
  const scoped = { equal: (family, label, actual, expected) => report.equal(family, `${algorithm}: ${label}`, actual, expected) };
  try { await runCLIConformance(workspace, scoped, algorithm); }
  finally { await workspace.dispose(); }
}

/** Native differential suite; emits an explicit skip marker only when the reference executable is absent. */
export async function runConformance({ algorithms = ['sha1', 'sha256'], emit = text => process.stdout.write(`${text}\n`) } = {}) {
  const availability = await gitAvailability();
  if (!availability.available) {
    const result = { schema: 'sharpforge.git.conformance.v1', skipped: true, reason: availability.reason, passed: 0, failed: 0 };
    emit(`SHARPFORGE_GIT_CONFORMANCE_SKIP ${JSON.stringify(result)}`);
    return result;
  }
  const report = new ConformanceReport(availability.version);
  const workspace = await fixtureWorkspace();
  const groups = [
    ...algorithms.map(algorithm => [`history-${algorithm}`, () => runHistoryConformance(workspace, report, algorithm)]),
    ...algorithms.map(algorithm => [`cli-http-${algorithm}`, () => runCLIFormat(report, algorithm)]),
    ['integrity', () => runIntegrityConformance(workspace, report)]
  ];
  try {
    for (const [name, run] of groups) {
      try { await run(); }
      catch (error) { report.failure(name, error); }
    }
  } finally { await workspace.dispose(); }
  const result = report.summary();
  emit(`SHARPFORGE_GIT_CONFORMANCE ${JSON.stringify(result)}`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('Use run.js [--output REPORT.json]');
  const result = await runConformance();
  if (args[0] === '--output') await writeFile(args[1], `${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.failed ? 1 : 0;
}
