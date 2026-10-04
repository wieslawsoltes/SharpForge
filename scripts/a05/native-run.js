import {spawnSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';

const json = value => JSON.stringify(value, null, 2) + '\n';
const normalize = value => String(value ?? '').replaceAll('\r\n', '\n');

function updateStatus(summary) {
  const counts = {};
  for (const item of summary.cases) counts[item.status] = (counts[item.status] ?? 0) + 1;
  summary.counts = counts;
  summary.status = counts.failed || counts.blocked ? 'failed' : counts.pending || counts.running ? 'running' :
    counts.unsupported ? 'partial' : 'passed';
  summary.passed = summary.status === 'passed';
}

async function saveSummary(output, summary) {
  updateStatus(summary);
  await writeFile(join(output, 'qualification.json'), json(summary));
}

/** Run serially, checkpoint after each case, and retain independent failures instead of stopping the matrix. */
export async function runNativePlan(plan, options) {
  const {output, root, environment, provenance, setupError = null, execute = spawnSync} = options;
  await mkdir(output, {recursive: true});
  const summary = {format: 'SharpForge.A05NativeQualification/1', task: 'SF-A05',
    startedAt: new Date().toISOString(), ...provenance, setupError,
    cases: plan.map(item => ({id: item.id, status: 'pending',
      command: {executable: process.execPath, arguments: item.args, cwd: root},
      environment: item.env ?? {}, timeoutMs: item.timeoutMs,
      evidence: relative(output, item.evidence ?? join(output, item.id)),
      report: join(item.id, 'result.json')}))};
  await saveSummary(output, summary);
  for (const [index, item] of plan.entries()) {
    const result = summary.cases[index];
    const directory = join(output, item.id);
    await mkdir(directory, {recursive: true});
    if (setupError) {
      result.status = 'blocked';
      result.reason = setupError;
    } else if (item.sdkMajor && Number(provenance.dotnetSdk.split('.')[0]) !== item.sdkMajor) {
      result.status = 'unsupported';
      result.reason = item.unsupportedReason;
    } else if (item.dependsOn && summary.cases.find(entry => entry.id === item.dependsOn)?.status !== 'passed') {
      result.status = 'blocked';
      result.reason = 'Required fresh evidence failed: ' + item.dependsOn;
    } else {
      result.status = 'running';
      result.startedAt = new Date().toISOString();
      await saveSummary(output, summary);
      const started = performance.now();
      let child;
      try {
        child = execute(process.execPath, item.args, {cwd: root, encoding: 'utf8',
          timeout: item.timeoutMs, maxBuffer: 32 * 1024 * 1024, env: {...environment, ...item.env}});
      } catch (error) {
        child = {error};
      }
      result.durationMs = performance.now() - started;
      result.exitCode = child.status ?? null;
      result.signal = child.signal ?? null;
      result.status = !child.error && child.status === 0 && !child.signal ? 'passed' : 'failed';
      if (child.error) result.error = {name: child.error.name, message: child.error.message, code: child.error.code};
      result.stdout = join(item.id, 'stdout.log');
      result.stderr = join(item.id, 'stderr.log');
      await writeFile(join(directory, 'stdout.log'), normalize(child.stdout));
      await writeFile(join(directory, 'stderr.log'), normalize(child.stderr));
    }
    result.finishedAt = new Date().toISOString();
    await writeFile(join(directory, 'result.json'), json(result));
    await saveSummary(output, summary);
    console.log(`${result.status.toUpperCase()} ${item.id}: ${join(directory, 'result.json')}`);
  }
  summary.finishedAt = new Date().toISOString();
  await saveSummary(output, summary);
  return summary;
}
