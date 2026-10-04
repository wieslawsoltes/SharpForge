import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { acceptance, executeScenario } from '../acceptance/run.js';
import { Child } from '../acceptance/child.js';
import { root } from '../acceptance/scenario.js';
import { git, hash, run, writeJSON, isMain } from '../repro/common.js';
import { loadManifest } from './manifest.js';
import { reproduceArchive } from './archive.js';

export function summarize(checks) {
  if (!checks.length) return 'blocked';
  if (
    checks.some((row) => row.status === 'failed' || row.status === 'cancelled')
  )
    return 'failed';
  return checks.every((row) => row.status === 'passed') ? 'passed' : 'blocked';
}
function blockerRow(blockers, id) {
  const blocker = blockers.get(id);
  if (!blocker) throw new Error('Unrecorded release15 blocker: ' + id);
  return blocker;
}
export function applyBrowserOutcomes(report, outcomes, blockers) {
  const observed = [];
  for (const step of report.steps) {
    const value = outcomes.get(step.id);
    if (value?.checks) step.phases = value.checks;
    if (!value?.blocker) continue;
    observed.push(blockerRow(blockers, value.blocker));
    if (step.status === 'passed') step.status = 'blocked';
  }
  if (observed.length) {
    report.blockers = observed;
    if (report.status === 'passed') report.status = 'blocked';
  }
  return report;
}
async function browserCheck(check, output, blockers, signal) {
  await mkdir(output);
  const child = new Child(
    process.env.PYTHON ?? 'python3',
    [join(root, 'scripts/conformance/release15/browser-driver.py'), output],
    {
      cwd: root,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        SHARPFORGE_RESULTS_DIR: output,
        SHARPFORGE_IN_MEMORY: '0',
      },
    },
  );
  const outcomes = new Map();
  const adapter = {
    step: async (step, options) => {
      const result = await child.request('step', step, options);
      if (result.value?.blocker)
        blockerRow(blockers, result.value.blocker);
      outcomes.set(step.id, result.value);
      return result;
    },
    close: async () => {
      try {
        if (!child.failure)
          await child.request('close', {}, { timeout: 10000 });
      } finally {
        await child.close();
      }
    },
  };
  const scenario = {
    schemaVersion: 1,
    id: check.id,
    timeoutMs: check.id === 'two-apps-two-instances' ? 240000 : check.id === 'keyboard-theme-dpi' ? 120000 : 30000,
    steps: check.actions.map((action, index) => ({
      id: `${check.id}-${index + 1}`,
      action,
    })),
  };
  const report = await executeScenario(scenario, {
    adapter,
    target: 'studio',
    ledger: { blockers: [] },
    output,
    signal,
  });
  applyBrowserOutcomes(report, outcomes, blockers);
  await writeJSON(join(output, 'report.json'), report);
  return report;
}
async function dispatch(check, options, blockers) {
  const { output, signal } = options;
  if (check.blocker)
    return {
      status: 'blocked',
      blocker: blockerRow(blockers, check.blocker),
      requiredSteps: check.steps,
    };
  if (check.adapter.startsWith('t12-')) {
    return acceptance({
      scenario: join(
        root,
        'tests/conformance/acceptance/scenarios',
        check.scenario + '.json',
      ),
      target: check.adapter === 't12-cli' ? 'cli' : 'studio',
      output,
      signal,
    });
  }
  if (check.adapter === 'browser')
    return browserCheck(check, output, blockers, signal);
  if (check.adapter === 'local-io') {
    const result = await run(
      process.execPath,
      [join(root, 'scripts/conformance/release15/local-io.js')],
      { cwd: root, timeout: 30000, signal },
    );
    return {
      status: 'passed',
      observed: JSON.parse(result.stdout),
      stderr: result.stderr,
    };
  }
  if (check.adapter === 'archive') {
    if (
      ![
        options.archive,
        options.sha256,
        options.commit,
        options.reference,
      ].every(Boolean)
    )
      return {
        status: 'blocked',
        blocker: blockerRow(blockers, 'SOURCE-ARCHIVE'),
      };
    return reproduceArchive({ ...options, root });
  }
  throw new Error('No executable adapter for ' + check.id);
}

/** Full fixture: continue independent checks, retaining every failed/blocked obligation. */
export async function release15(options = {}) {
  const output = resolve(
    options.output ?? join(root, 'artifacts/results/release15'),
  );
  if (await git(root, ['status', '--porcelain']))
    throw new Error('Release15 requires a clean committed checkout');
  const commit = await git(root, ['rev-parse', 'HEAD']);
  const { scenario, ledger, blockers } = await loadManifest();
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const report = {
    schemaVersion: 1,
    task: scenario.task,
    commit,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    scenarioSha256: hash(JSON.stringify(scenario)),
    blockersSha256: hash(JSON.stringify(ledger)),
    status: 'running',
    checks: [],
    scope:
      'Component observations plus explicit unmet cross-area obligations; no publication or provider mutations',
  };
  const flush = () => writeJSON(join(output, 'report.json'), report);
  await flush();
  for (const check of scenario.checks) {
    const row = {
      id: check.id,
      requirement: check.requirement,
      scope: check.scope,
      status: 'running',
    };
    report.checks.push(row);
    await flush();
    const start = performance.now();
    try {
      if (options.signal?.aborted) throw new Error('Cancelled');
      const result = await dispatch(
        check,
        { ...options, output: join(output, check.id) },
        blockers,
      );
      if (!['passed', 'failed', 'blocked', 'cancelled'].includes(result.status))
        throw new Error('Invalid adapter result status');
      row.status = result.status;
      row.blockers =
        result.blockers ?? (result.blocker ? [result.blocker] : []);
      row.artifact = check.id + '/result.json';
      await writeJSON(join(output, row.artifact), result);
      row.sha256 = hash(await readFile(join(output, row.artifact)));
    } catch (error) {
      row.status = options.signal?.aborted ? 'cancelled' : 'failed';
      row.error = error.message;
    }
    row.milliseconds = performance.now() - start;
    await flush();
    if (options.signal?.aborted) break;
  }
  report.unexecuted = scenario.checks
    .slice(report.checks.length)
    .map((check) => check.id);
  report.status = summarize(report.checks);
  if (
    report.unexecuted.length ||
    (await git(root, ['rev-parse', 'HEAD'])) !== commit ||
    (await git(root, ['status', '--porcelain']))
  ) {
    report.status = 'failed';
    report.error = 'Incomplete run or source checkout changed';
  }
  await flush();
  return report;
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      output: { type: 'string' },
      archive: { type: 'string' },
      sha256: { type: 'string' },
      commit: { type: 'string' },
      reference: { type: 'string' },
    },
  });
  const controller = new AbortController(),
    cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const report = await release15({ ...values, signal: controller.signal });
    console.log(JSON.stringify(report));
    process.exitCode =
      report.status === 'passed' ? 0 : report.status === 'blocked' ? 2 : 1;
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
