import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from './planning/run-tests.js';
import { writeReport, isMain } from './editor-benchmarks/common.js';
import { validateEditorReport, compareEditorPerformance } from './check-editor-perf.js';
import { loadPerformanceBaselines } from './project16-baselines.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, process.env.SHARPFORGE_RESULTS_DIR || 'artifacts/results/project16');
const engine = process.env.SHARPFORGE_BROWSER_ENGINE || 'chromium';
const python = process.env.PYTHON || 'python';
const browserSupervisorTimeout = 1_320_000;
const stages = new Set(['node', 'browser', 'performance', 'all']);
const suites = ['workbench-docking', 'workbench-shell', 'workbench-sessions', 'workbench-lazy',
  'workbench-workflows', 'editor-insights', 'editor-providers', 'editor-view'];

async function run(command, args, timeout = 1_200_000) {
  const code = await runProcess(command, args, { cwd: root, timeout });
  if (code) {
    const error = new Error(`Qualification failed (${code}): ${command} ${args.join(' ')}`);
    error.exitCode = code;
    throw error;
  }
}

/** Serial capture orchestration; injectable I/O lets preflight regressions run without starting benchmarks. */
export async function performance({ runCapture = run, read = readFile, write = writeReport, host, env = process.env,
  selectedEngine = engine, checkoutRoot = root, outputDirectory = directory } = {}) {
  const { editor: baseline, workbench } = await loadPerformanceBaselines({ root: checkoutRoot, engine: selectedEngine, host, read,
    editorPath: env.SHARPFORGE_EDITOR_BASELINE, workbenchPath: env.SHARPFORGE_WORKBENCH_BASELINE });
  if (workbench) env.SHARPFORGE_WORKBENCH_BASELINE = workbench.path;
  const browserPath = resolve(outputDirectory, 'editor-browser.json');
  await runCapture(process.execPath, ['scripts/limited.js', 'node', 'scripts/benchmark-editor.js', '--backend', 'model',
    '--output', resolve(outputDirectory, 'editor-model.json')]);
  await runCapture(process.execPath, ['scripts/limited.js', 'node', '--expose-gc', 'scripts/benchmark-editor-memory.js',
    '--output', resolve(outputDirectory, 'editor-memory.json')]);
  await runCapture(process.execPath, ['scripts/limited.js', 'node', 'scripts/benchmark-editor.js', '--backend', 'browser',
    '--browser', selectedEngine, '--sizes', '1024,1048576,10485760,104857600,209715200', '--output', browserPath]);
  const current = JSON.parse(await read(browserPath, 'utf8'));
  validateEditorReport(current);
  const typing = current.rows.find(row => row.sizeBytes === 209_715_200 && row.operation === 'browser.keystrokeToPaint');
  if (!typing) throw new Error('The 200 MiB editor typing measurement is missing');
  const assessment = {
    mode: baseline ? 'compare' : 'capture', absolutePassed: typing.p95Ms < 50,
    largeFile: { sizeBytes: typing.sizeBytes, measuredP95Ms: typing.p95Ms, budgetMs: 50,
      measurement: typing.measurement }, regressionVerdict: null
  };
  if (baseline) {
    assessment.comparison = compareEditorPerformance(baseline.report, current, { requireBrowser: true });
    assessment.regressionVerdict = assessment.comparison.passed;
  }
  await write(resolve(outputDirectory, 'editor-assessment.json'), assessment);
  await runCapture(python, ['tests/conformance/browser/run_suite.py', 'workbench-performance', '--timeout', '1200'], browserSupervisorTimeout);
  if (!assessment.absolutePassed || assessment.regressionVerdict === false) throw new Error('Editor latency budget failed');
  return assessment;
}

/** Run independent scopes serially, checkpoint every outcome, and return the required aggregate process exit code. */
export async function qualify({ stage = 'all', selectedEngine = engine, outputDirectory = directory, env = process.env,
  runScope = run, runPerformance = performance, write = writeReport, now = () => new Date().toISOString() } = {}) {
  if (!stages.has(stage)) throw new Error('Choose node, browser, performance, or all');
  if (!['chromium', 'firefox', 'webkit'].includes(selectedEngine)) throw new Error('Unsupported qualification browser');
  const scopes = [];
  if (stage === 'node' || stage === 'all') {
    for (const area of ['A19', 'A20']) scopes.push({ id: 'node:' + area, phase: 'node', command: process.execPath,
      args: ['scripts/planning/run-tests.js', '--area', area], timeoutMs: 1_200_000 });
  }
  if (stage === 'browser' || stage === 'all') {
    for (const suite of suites) scopes.push({ id: 'browser:' + suite, phase: 'browser', command: env.PYTHON || python,
      args: ['tests/conformance/browser/run_suite.py', suite, '--timeout', '1200'], timeoutMs: browserSupervisorTimeout });
  }
  if (stage === 'performance' || stage === 'all') scopes.push({ id: 'performance', phase: 'performance' });
  for (const scope of scopes) scope.status = 'pending';
  const report = { schemaVersion: 1, kind: 'sharpforge-project16-qualification', stage, engine: selectedEngine,
    sourceSha: env.QUALIFICATION_SOURCE_SHA ?? null, sourceTree: env.QUALIFICATION_SOURCE_TREE ?? null,
    workflowRunId: env.GITHUB_RUN_ID ?? null, startedAt: now(), finishedAt: null, status: 'running', exitCode: null, scopes };
  const reportPath = resolve(outputDirectory, 'qualification-summary.json');
  env.SHARPFORGE_RESULTS_DIR = outputDirectory;
  env.SHARPFORGE_BROWSER_ENGINE = selectedEngine;
  await write(reportPath, report);
  for (const scope of scopes) {
    scope.status = 'running';
    scope.startedAt = now();
    await write(reportPath, report);
    try {
      if (scope.phase === 'performance') {
        scope.assessment = await runPerformance({ env, selectedEngine, outputDirectory, runCapture: runScope });
      } else await runScope(scope.command, scope.args, scope.timeoutMs);
      scope.status = 'passed';
      scope.exitCode = 0;
    } catch (error) {
      scope.status = 'failed';
      scope.exitCode = Number.isInteger(error?.exitCode) && error.exitCode > 0 ? error.exitCode : 1;
      scope.error = { name: error?.name ?? 'Error', message: String(error?.message ?? error), code: error?.code ?? null };
    }
    scope.finishedAt = now();
    await write(reportPath, report);
  }
  const failed = scopes.filter(scope => scope.status === 'failed').length;
  report.counts = { selected: scopes.length, passed: scopes.length - failed, failed };
  report.status = failed ? 'failed' : 'passed';
  report.exitCode = failed ? 1 : 0;
  report.finishedAt = now();
  await write(reportPath, report);
  return report;
}

if (isMain(import.meta.url)) {
  try { process.exitCode = (await qualify({ stage: process.argv[2] || 'all' })).exitCode; }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
