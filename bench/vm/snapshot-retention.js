import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReport, completeReport, hash, isMain, recordError, root} from './evidence.js';
import {retentionScenarios, retentionSnapshots, retentionPayloadBytes} from './snapshot-retention-fixtures.js';

export function snapshotRetentionOptions(arguments_) {
  const options = {scenario: 'all', maxRetainedMiB: 1536};
  const names = new Map([['--runner', 'runner'], ['--out', 'out'], ['--scenario', 'scenario'], ['--max-retained-mib', 'maxRetainedMiB']]);
  const seen = new Set();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index], value = arguments_[index + 1];
    if (!names.has(name) || seen.has(name) || value === undefined) throw new TypeError('Invalid or repeated retention option');
    seen.add(name);
    options[names.get(name)] = name === '--max-retained-mib' ? Number(value) : value;
  }
  if (!options.runner || !options.out || !['all', ...retentionScenarios].includes(options.scenario) ||
      !Number.isInteger(options.maxRetainedMiB) || options.maxRetainedMiB < 64 || options.maxRetainedMiB > 2048) {
    throw new RangeError('Expected --runner ID --out FILE [--scenario NAME] [--max-retained-mib 64..2048]');
  }
  return options;
}

export function measureSnapshotRetention(scenario, capBytes) {
  const worker = fileURLToPath(new URL('./snapshot-retention-worker.js', import.meta.url));
  const arguments_ = ['--max-old-space-size=512', '--expose-gc', worker, scenario, String(capBytes)];
  const child = spawnSync(process.execPath, arguments_, {cwd: root, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024});
  const trace = (child.stdout ?? '') + (child.stderr ?? '');
  if (child.error || child.status !== 0) throw Object.assign(child.error ?? new Error(
    `Snapshot retention child failed: ${child.status}/${child.signal}`), {trace});
  const row = JSON.parse(child.stdout);
  return {row: {...row, command: [process.execPath, ...arguments_], traceSHA256: hash(trace)}, trace};
}

function main() {
  const options = snapshotRetentionOptions(process.argv.slice(2)), destination = resolve(options.out);
  if (existsSync(destination)) throw new Error('Refusing to overwrite snapshot retention evidence');
  const report = createReport({name: 'snapshot-retention-v1', snapshots: retentionSnapshots,
    typedPayloadBytes: retentionPayloadBytes, ...options}, options.runner);
  report.format = 'SharpForge.SnapshotRetention/1';
  report.suite = 'SF-A05-T06.2';
  report.measurementKind = 'post-GC-host-retention';
  report.unit = 'bytes';
  if (report.worktreeStatus) throw new Error('Snapshot retention qualification requires a clean committed worktree');
  mkdirSync(dirname(destination), {recursive: true});
  try {
    for (const scenario of options.scenario === 'all' ? retentionScenarios : [options.scenario]) {
      const {row, trace} = measureSnapshotRetention(scenario, options.maxRetainedMiB * 1024 * 1024);
      const tracePath = destination + '.' + scenario + '.log';
      writeFileSync(tracePath, trace, {flag: 'wx'});
      report.rows.push({...row, tracePath});
    }
    report.status = 'measured';
    report.acceptance = 'workload-specific';
    report.limit = 'The issue does not define a mutation unit or include/exclude the live heap. ' +
      'Record-fraction and byte-fraction workloads are reported separately; this probe grants no universal or cross-platform pass.';
  } catch (error) {
    report.status = 'failed';
    report.errors.push(recordError(error));
    if (error.trace) writeFileSync(destination + '.failed.log', error.trace, {flag: 'wx'});
  }
  completeReport(report);
  writeFileSync(destination, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  process.exitCode = report.status === 'failed' ? 1 : report.rows.some(row => row.assessment.status !== 'met-for-this-workload') ? 2 : 0;
}

if (isMain(import.meta.url)) main();
