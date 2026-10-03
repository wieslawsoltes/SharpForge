import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { readJSON, files, isMain, cli } from './common.js';
import { compareBuilds } from './double-build.js';
export function aggregate(reports, required = ['linux-x64', 'darwin-arm64', 'win32-x64']) {
  const platforms = new Set();
  for (const report of reports) {
    if (!report.passed) throw new Error(`Failed runner report: ${report.platform}`);
    if (platforms.has(report.platform)) throw new Error(`Duplicate runner platform: ${report.platform}`);
    platforms.add(report.platform);
  }
  for (const platform of required)
    if (!platforms.has(platform)) throw new Error(`Missing independent runner: ${platform}`);
  const comparisons = reports
    .slice(1)
    .map((report) => ({ platform: report.platform, ...compareBuilds(reports[0], report) }));
  return {
    schemaVersion: 1,
    passed: comparisons.every((row) => row.passed),
    commit: reports[0].commit,
    platforms: [...platforms].sort(),
    comparisons,
  };
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      directory: { type: 'string', default: 'artifacts/repro-runners' },
      platforms: { type: 'string', default: 'linux-x64,darwin-arm64,win32-x64' },
    },
  });
  await cli(
    async () => {
      const reports = [];
      for (const file of await files(resolve(values.directory)))
        if (file.endsWith('/summary.json') || file === 'summary.json')
          reports.push(await readJSON(join(values.directory, file)));
      return aggregate(reports, values.platforms.split(','));
    },
    { report: 'artifacts/results/repro/cross-runner.json' },
  );
}
