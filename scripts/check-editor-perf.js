import { readFile } from 'node:fs/promises';
import { parseArguments, distribution, isMain, writeReport } from './editor-benchmarks/common.js';

function identity(row) { return `${row.backend}/${row.sizeBytes}/${row.operation}`; }

export function validateEditorReport(report) {
  if (report?.schemaVersion !== 1 || report.kind !== 'sharpforge-editor-latency' || !Array.isArray(report.rows) || !report.rows.length
      || !report.environment || report.correctness?.passed !== true) throw new Error('Invalid or unsuccessful editor performance report');
  const keys = new Set();
  for (const row of report.rows) {
    const key = identity(row);
    if (keys.has(key) || !['node-model', 'browser-chromium', 'browser-firefox', 'browser-webkit'].includes(row.backend)
        || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1 || !row.operation || row.correctness?.passed !== true) {
      throw new Error(`Invalid editor benchmark row '${key}'`);
    }
    if (!Array.isArray(row.rawSamplesMs) || row.rawSamplesMs.length < 3) throw new Error(`Insufficient samples for '${key}'`);
    const measured = distribution(row.rawSamplesMs);
    for (const percentile of ['p50Ms', 'p95Ms', 'p99Ms']) {
      if (row[percentile] !== measured[percentile]) throw new Error(`Percentile differs from raw samples for '${key}'`);
    }
    keys.add(key);
  }
  return true;
}

/** Fails any p95 regression strictly above 20%, missing measurement or incompatible runner; no averaging away regressions. */
export function compareEditorPerformance(baseline, current, { threshold = .20, allowEnvironmentChange = false, requireBrowser = false } = {}) {
  validateEditorReport(baseline);
  validateEditorReport(current);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new RangeError('Invalid editor regression threshold');
  const environmentKeys = ['node', 'platform', 'arch', 'cpu', 'browser', 'browserVersion'];
  const environmentChanges = environmentKeys.filter(key => baseline.environment[key] !== current.environment[key]);
  if (environmentChanges.length && !allowEnvironmentChange) throw new Error(`Benchmark environment changed: ${environmentChanges.join(', ')}`);
  const measured = new Map(current.rows.map(row => [identity(row), row]));
  const comparisons = [];
  for (const before of baseline.rows) {
    const id = identity(before);
    const after = measured.get(id);
    if (!after) throw new Error(`Missing editor benchmark '${id}'`);
    const relative = before.p95Ms === 0 ? after.p95Ms === 0 ? 0 : Infinity : after.p95Ms / before.p95Ms - 1;
    comparisons.push({ id, baselineP95Ms: before.p95Ms, currentP95Ms: after.p95Ms,
      relativeChange: Number.isFinite(relative) ? relative : null, threshold, passed: relative <= threshold + Number.EPSILON * 4 });
    measured.delete(id);
  }
  if (measured.size) throw new Error('Editor benchmark set changed; baseline review is required');
  if (requireBrowser && !current.rows.some(row => row.backend.startsWith('browser-'))) throw new Error('Browser measurements are required for this gate');
  return { schemaVersion: 1, kind: 'sharpforge-editor-regression', passed: comparisons.every(row => row.passed),
    threshold, environmentChanges, baselineCommit: baseline.environment.commit, currentCommit: current.environment.commit, rows: comparisons };
}

if (isMain(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  if (!args.baseline || !args.current) throw new Error('Usage: --baseline file --current file [--threshold 0.20] [--output file]');
  const baseline = JSON.parse(await readFile(args.baseline, 'utf8'));
  const current = JSON.parse(await readFile(args.current, 'utf8'));
  const result = compareEditorPerformance(baseline, current, { threshold: args.threshold === undefined ? .20 : Number(args.threshold),
    allowEnvironmentChange: Boolean(args['allow-environment-change']), requireBrowser: Boolean(args['require-browser']) });
  if (args.output) await writeReport(args.output, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}
