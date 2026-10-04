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
  if (code) throw new Error(`Qualification failed (${code}): ${command} ${args.join(' ')}`);
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

async function main() {
  const stage = process.argv[2] || 'all';
  if (!stages.has(stage)) throw new Error('Choose node, browser, performance, or all');
  if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error('Unsupported qualification browser');
  process.env.SHARPFORGE_RESULTS_DIR = directory;
  if (stage === 'node' || stage === 'all') {
    for (const area of ['A19', 'A20']) await run(process.execPath, ['scripts/planning/run-tests.js', '--area', area]);
  }
  if (stage === 'browser' || stage === 'all') {
    for (const suite of suites) {
      await run(python, ['tests/conformance/browser/run_suite.py', suite, '--timeout', '1200'], browserSupervisorTimeout);
    }
  }
  if (stage === 'performance' || stage === 'all') await performance();
}

if (isMain(import.meta.url)) {
  try { await main(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
