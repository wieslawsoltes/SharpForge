import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { readScenario, root as repository } from './scenario.js';
import { readBlockers, recordedBlocker, unavailable } from './blockers.js';
import { CliAdapter } from './cli-adapter.js';
import { StudioAdapter } from './studio-adapter.js';
import { git, hash, writeJSON, isMain } from '../repro/common.js';

export async function executeScenario(
  scenario,
  { adapter, target, ledger, output, signal },
) {
  const report = {
    schemaVersion: 1,
    scenario: scenario.id,
    target,
    status: 'passed',
    steps: [],
  };
  const flush = () => writeJSON(join(output, 'report.json'), report);
  try {
    report.dependencies = [
      ...new Set(
        scenario.steps.map((step) => unavailable[step.action]).filter(Boolean),
      ),
    ].map((id) => recordedBlocker(ledger, id, scenario.id, target));
    for (const step of scenario.steps) {
      const row = { id: step.id, action: step.action, status: 'running' };
      report.steps.push(row);
      await flush();
      const start = performance.now();
      try {
        if (signal?.aborted) throw new Error('Cancelled');
        const blocker = unavailable[step.action];
        if (blocker) {
          row.blocker = recordedBlocker(ledger, blocker, scenario.id, target);
          row.status = 'blocked';
          report.status = 'blocked';
        } else {
          const result = await adapter.step(step, {
            signal,
            timeout: step.timeoutMs ?? scenario.timeoutMs,
          });
          const artifact = step.id + '.json';
          await writeJSON(join(output, artifact), result);
          row.artifact = {
            path: artifact,
            sha256: hash(await readFile(join(output, artifact))),
          };
          row.status = 'passed';
        }
      } catch (error) {
        row.status = signal?.aborted ? 'cancelled' : 'failed';
        row.error = error.message;
        report.status = row.status;
      } finally {
        row.milliseconds = performance.now() - start;
        await flush();
      }
      if (row.status !== 'passed') break;
    }
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
  } finally {
    try {
      await adapter.close();
    } catch (error) {
      report.status = 'failed';
      report.disposalError = error.message;
    }
    await flush();
  }
  report.unexecutedSteps = scenario.steps
    .slice(report.steps.length)
    .map((s) => s.id);
  await flush();
  return report;
}
export async function acceptance({
  scenario: path,
  target = 'cli',
  root = repository,
  output,
  signal,
} = {}) {
  root = resolve(root);
  const scenario = await readScenario(path);
  if (!scenario.targets.includes(target))
    throw new Error('Scenario does not support target ' + target);
  if (await git(root, ['status', '--porcelain']))
    throw new Error('Acceptance requires a clean committed source checkout');
  const commit = await git(root, ['rev-parse', 'HEAD']),
    ledger = await readBlockers();
  output = resolve(
    output ?? join(root, 'artifacts/results/acceptance', scenario.id, target),
  );
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const workspace = await mkdtemp(join(tmpdir(), 'sharpforge-acceptance-'));
  const provenance = {
    commit,
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    target,
    scenarioSha256: hash(await readFile(path)),
    ledgerSha256: hash(JSON.stringify(ledger)),
    scope:
      target === 'cli'
        ? 'Real CLI compile and stdio DAP; source-combined project references'
        : 'Real served Studio with production workers; Playwright managed Chromium',
  };
  let report;
  try {
    const adapter =
      target === 'cli'
        ? new CliAdapter({ root, workspace })
        : new StudioAdapter({ root, output });
    report = await executeScenario(scenario, {
      adapter,
      target,
      ledger,
      output,
      signal,
    });
    report.provenance = provenance;
    if (
      (await git(root, ['rev-parse', 'HEAD'])) !== commit ||
      (await git(root, ['status', '--porcelain']))
    ) {
      report.status = 'failed';
      report.error = 'Source checkout changed during acceptance';
    }
    await writeJSON(join(output, 'report.json'), report);
    return report;
  } catch (error) {
    report = {
      schemaVersion: 1,
      scenario: scenario.id,
      target,
      status: signal?.aborted ? 'cancelled' : 'failed',
      provenance,
      error: error.message,
      steps: [],
    };
    await writeJSON(join(output, 'report.json'), report);
    return report;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string' },
      target: { type: 'string', default: 'cli' },
      output: { type: 'string' },
    },
  });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const report = await acceptance({ ...values, signal: controller.signal });
    console.log(JSON.stringify(report));
    process.exitCode =
      report.status === 'passed' ? 0 : report.status === 'blocked' ? 2 : 1;
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
