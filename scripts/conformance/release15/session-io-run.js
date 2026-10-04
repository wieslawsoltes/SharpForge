import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { executeScenario } from '../acceptance/run.js';
import { root } from '../acceptance/scenario.js';
import { readBuildIdentity } from '../build-identity.js';
import { git, hash, inventory, isMain, readRegular, writeJSON } from '../repro/common.js';
import { requireCompletedBuild, sessionIOLimits, validateSessionIO } from './session-io-report.js';
import { sessionIOBrowserAdapter, validateSessionIOBrowserClose } from './session-io-adapter.js';

const scenario = Object.freeze({
  schemaVersion: 1,
  id: 'release15-session-io',
  timeoutMs: 240000,
  steps: [{ id: 'session-io', action: 'session-io' }],
});

async function driverFailure(browser) {
  try {
    return JSON.parse(await readRegular(join(browser, 'session-io-driver-failure.json'), { maxBytes: 64 * 1024 }));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** One complete real-browser slice; never upgrades this observation to the wider release obligation. */
export async function runSessionIO({ output: destination, signal } = {}) {
  const output = resolve(destination ?? join(root, 'artifacts/results/release15-session-io'));
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const report = {
    schemaVersion: 1, task: 'SF-R015-T04', scenario: scenario.id, status: 'running', componentStatus: 'unexecuted',
    node: process.version, platform: `${process.platform}-${process.arch}`, scenarioSha256: hash(JSON.stringify(scenario)),
    limits: [...sessionIOLimits], artifacts: [],
  };
  await writeJSON(join(output, 'report.json'), report);
  let build;
  try {
    if (signal?.aborted) throw new Error('Session I/O cancelled before setup');
    if (await git(root, ['status', '--porcelain'])) throw new Error('Session I/O requires a clean committed checkout');
    report.commit = await git(root, ['rev-parse', 'HEAD']);
    build = await readBuildIdentity(root, join(root, 'dist'));
    requireCompletedBuild(build.manifest, report.commit);
    report.buildIdentitySha256 = build.sha256;
    await writeFile(join(output, 'build-identity.json'), build.bytes);
    const browser = join(output, 'browser');
    await mkdir(browser);
    const adapter = sessionIOBrowserAdapter(root, browser);
    const execution = await executeScenario(scenario, {
      adapter, target: 'studio', ledger: { blockers: [] }, output: browser, signal,
    });
    await writeFile(join(output, 'browser-adapter-stderr.txt'), adapter.child.stderr, 'utf8');
    report.execution = { status: execution.status, report: 'browser/report.json' };
    if (execution.status !== 'passed') {
      report.driverFailure = await driverFailure(browser);
      const unavailable = report.driverFailure?.status === 'unavailable';
      throw new Error(unavailable ? `Browser capability unavailable: ${report.driverFailure.message}`
        : 'Browser session I/O failed; see the retained step and phase observations');
    }
    const observationBytes = await readRegular(join(browser, 'session-io-observations.json'), { maxBytes: 4 * 1024 * 1024 });
    const observation = JSON.parse(observationBytes);
    const browserClose = JSON.parse(await readRegular(join(browser, 'studio-driver/session.json'), { maxBytes: 4 * 1024 * 1024 }));
    validateSessionIOBrowserClose(browserClose, observation);
    const sourceSha256 = hash(await readRegular(join(browser, 'session-io-source.json'), { maxBytes: 1024 * 1024 }));
    Object.assign(report, validateSessionIO(observation, { commit: report.commit, assets: build.manifest.assets, sourceSha256 }));
    report.observation = { path: 'browser/session-io-observations.json', sha256: hash(observationBytes) };
  } catch (error) {
    report.status = signal?.aborted ? 'cancelled' : 'failed';
    report.componentStatus = signal?.aborted ? 'cancelled' : report.driverFailure?.status === 'unavailable' ? 'unexecuted' : 'failed';
    report.error = error.message;
  }
  try {
    if (report.commit && ((await git(root, ['rev-parse', 'HEAD'])) !== report.commit
      || (await git(root, ['status', '--porcelain'])))) throw new Error('The source checkout changed during session I/O');
    if (build && (await readBuildIdentity(root, join(root, 'dist'))).sha256 !== build.sha256) {
      throw new Error('The completed build changed during session I/O');
    }
    report.artifacts = (await inventory(output)).filter(row => row.path !== 'report.json');
  } catch (error) {
    report.status = report.componentStatus = 'failed';
    report.integrityError = error.message;
  }
  await writeJSON(join(output, 'report.json'), report);
  return report;
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { output: { type: 'string' } } });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const report = await runSessionIO({ ...values, signal: controller.signal });
    console.log(JSON.stringify(report));
    process.exitCode = report.status === 'blocked' ? 2 : 1;
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
