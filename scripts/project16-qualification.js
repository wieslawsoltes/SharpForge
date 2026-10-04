import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from './planning/run-tests.js';
import { writeReport } from './editor-benchmarks/common.js';
import { validateEditorReport, compareEditorPerformance } from './check-editor-perf.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, process.env.SHARPFORGE_RESULTS_DIR || 'artifacts/results/project16');
const engine = process.env.SHARPFORGE_BROWSER_ENGINE || 'chromium';
const python = process.env.PYTHON || 'python';
const browserSupervisorTimeout = 1_320_000;
const stages = new Set(['node', 'browser', 'performance', 'all']);
const suites = ['workbench-docking', 'workbench-shell', 'workbench-sessions', 'workbench-lazy',
  'workbench-workflows', 'editor-insights', 'editor-providers', 'editor-view'];

function repositoryFile(value) {
  if (!value) return null;
  const path = resolve(root, value);
  const subpath = relative(root, path);
  if (!subpath || isAbsolute(subpath) || subpath === '..' || subpath.startsWith('../') || subpath.startsWith('..\\')) {
    throw new Error('A performance baseline must be a file inside the checkout');
  }
  return path;
}

async function run(command, args, timeout = 1_200_000) {
  const code = await runProcess(command, args, { cwd: root, timeout });
  if (code) throw new Error(`Qualification failed (${code}): ${command} ${args.join(' ')}`);
}

async function performance() {
  const baseline = repositoryFile(process.env.SHARPFORGE_EDITOR_BASELINE);
  const workbench = repositoryFile(process.env.SHARPFORGE_WORKBENCH_BASELINE);
  if (workbench) process.env.SHARPFORGE_WORKBENCH_BASELINE = workbench;
  const browserPath = resolve(directory, 'editor-browser.json');
  await run(process.execPath, ['scripts/limited.js', 'node', 'scripts/benchmark-editor.js', '--backend', 'model',
    '--output', resolve(directory, 'editor-model.json')]);
  await run(process.execPath, ['scripts/limited.js', 'node', '--expose-gc', 'scripts/benchmark-editor-memory.js',
    '--output', resolve(directory, 'editor-memory.json')]);
  await run(process.execPath, ['scripts/limited.js', 'node', 'scripts/benchmark-editor.js', '--backend', 'browser',
    '--browser', engine, '--sizes', '1024,1048576,10485760,104857600,209715200', '--output', browserPath]);
  const current = JSON.parse(await readFile(browserPath, 'utf8'));
  validateEditorReport(current);
  const typing = current.rows.find(row => row.sizeBytes === 209_715_200 && row.operation === 'browser.keystrokeToPaint');
  if (!typing) throw new Error('The 200 MiB editor typing measurement is missing');
  const assessment = {
    mode: baseline ? 'compare' : 'capture', absolutePassed: typing.p95Ms < 50,
    largeFile: { sizeBytes: typing.sizeBytes, measuredP95Ms: typing.p95Ms, budgetMs: 50,
      measurement: typing.measurement }, regressionVerdict: null
  };
  if (baseline) {
    assessment.comparison = compareEditorPerformance(JSON.parse(await readFile(baseline, 'utf8')), current, { requireBrowser: true });
    assessment.regressionVerdict = assessment.comparison.passed;
  }
  await writeReport(resolve(directory, 'editor-assessment.json'), assessment);
  await run(python, ['tests/conformance/browser/run_suite.py', 'workbench-performance', '--timeout', '1200'], browserSupervisorTimeout);
  if (!assessment.absolutePassed || assessment.regressionVerdict === false) throw new Error('Editor latency budget failed');
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

try { await main(); }
catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
