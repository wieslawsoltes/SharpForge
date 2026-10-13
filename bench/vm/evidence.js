import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {hostname, cpus, totalmem, release} from 'node:os';
import {readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, rmSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {distribution} from './statistics.js';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const hash = value => createHash('sha256').update(value).digest('hex');
export const stable = value => JSON.stringify(canonical(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();

export function measurementRevision() {
  return {commit: git('rev-parse', 'HEAD'), worktreeStatus: git('status', '--porcelain=v1')};
}

export function createReport(protocol, runner) {
  if (!runner || !/^[\w.-]{1,80}$/.test(runner)) throw new TypeError('An explicit stable --runner identifier is required');
  const processors = cpus();
  const environment = {runner, host: hash(hostname()), platform: process.platform, arch: process.arch, os: release(),
    cpuModels: [...new Set(processors.map(cpu => cpu.model))].sort(), logicalCpus: processors.length, memoryBytes: totalmem(),
    node: process.version, v8: process.versions.v8, versions: process.versions, executable: process.execPath,
    execArgv: process.execArgv, gcExposed: typeof globalThis.gc === 'function',
    locale: {LANG: process.env.LANG ?? '', LC_ALL: process.env.LC_ALL ?? '', TZ: process.env.TZ ?? ''}};
  const sources = readdirSync(new URL('./', import.meta.url)).filter(name => name.endsWith('.js')).sort();
  const harnessHash = hash(sources.map(name => name + '\n' + readFileSync(new URL(name, import.meta.url))).join('\n'));
  return {schemaVersion: 2, suite: 'SF-A05-T12', status: 'running', measurementKind: 'runtime-benchmark', nativeQualification: false,
    startedAt: new Date().toISOString(), command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
    ...measurementRevision(), harnessHash, environment, environmentFingerprint: hash(stable(environment)), protocol, rows: [], errors: [],
    unsupportedTargets: ['Browser timing/host-memory: this Node harness does not qualify browsers',
      'Native .NET throughput: no CLR executable is measured', 'Wasm tier: interpreter baseline options explicitly disable it']};
}

export function finalizeRow(row) {
  const measured = row.samples.filter(sample => sample.phase === 'measured');
  row.summary = Object.fromEntries(Object.keys(row.metrics).map(key => [key, distribution(measured.map(sample => sample[key]))]));
  row.status = 'measured';
  return row;
}

export function completeReport(report) {
  const revision = measurementRevision();
  report.completedCommit = revision.commit;
  report.completedWorktreeStatus = revision.worktreeStatus;
  if (revision.commit !== report.commit || revision.worktreeStatus !== '') {
    report.status = 'failed';
    report.errors.push({name: 'MeasurementRevisionError', message: 'Code or worktree changed during measurement'});
  }
  report.completedAt = new Date().toISOString();
  return report;
}

export function recordError(error) {
  return {name: error?.name ?? 'Error', message: error?.message ?? String(error), stack: error?.stack};
}

/** Replace the destination atomically; an interrupted write cannot leave a valid-looking truncated baseline. */
export function writeReport(report, path) {
  const target = resolve(path);
  mkdirSync(dirname(target), {recursive: true});
  const temporary = target + `.writing-${process.pid}`;
  try {
    writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n');
    renameSync(temporary, target);
  } finally { rmSync(temporary, {force: true}); }
}

export function measuredMetric(unit, statistics = ['median', 'p95', 'p99'], direction = 'higher') {
  return {unit, statistics, direction};
}
export const isMain = url => process.argv[1] && fileURLToPath(url) === resolve(process.argv[1]);
