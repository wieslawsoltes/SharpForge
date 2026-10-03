import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

function git(...args) {
  return execFileSync('git', args, {encoding: 'utf8'}).trimEnd();
}
export function distribution(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const quantile = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return {count: values.length, minimum: sorted[0], median: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99), maximum: sorted.at(-1)};
}
export function evidence(task, script) {
  return {
    schemaVersion: 1, task, startedAt: new Date().toISOString(), passed: false,
    commit: git('rev-parse', 'HEAD'), worktreeStatus: git('status', '--porcelain=v1'),
    trackedDiffSha256: createHash('sha256').update(git('diff', '--binary', 'HEAD')).digest('hex'),
    scriptSha256: createHash('sha256').update(readFileSync(script)).digest('hex'),
    command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
    node: process.version, v8: process.versions.v8, platform: process.platform, architecture: process.arch,
    nativeQualification: false,
    measurements: 'First iteration and warmed iterations in one existing process; all raw samples retained. Managed heap counters exclude host JavaScript graph allocation.',
    results: [], errors: []
  };
}
export function failure(error) {
  return {name: error.name, message: error.message, stack: error.stack, details: error.details ?? null};
}
export function requireResult(condition, message, details) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}
export function publish(report, output) {
  report.completedAt = new Date().toISOString();
  const text = JSON.stringify(report, null, 2) + '\n';
  if (output) {
    mkdirSync(dirname(output), {recursive: true});
    writeFileSync(output, text);
  }
  process.stdout.write(text);
  if (!report.passed) process.exitCode = 1;
}
