import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { args, integer, repository, clean, writeJson, sha } from '../../../scripts/conformance/perf/core.js';
import { execute } from '../../../scripts/conformance/perf/process.js';
import { controlCases, objectCases } from './verifier-benchmark-workloads.mjs';

const [destination, ...argv] = process.argv.slice(2);
const options = args(argv);
if (!destination || !options.baseline) throw new Error('Pass a fresh output directory and --baseline checkout');
const output = resolve(destination);
const trees = { baseline: resolve(options.baseline), candidate: resolve(options.candidate ?? repository) };
const commits = Object.fromEntries(Object.entries(trees).map(([side, root]) => [side, clean(root)]));
const harnessCommit = clean(repository);
const iterations = integer(options.iterations, 1000, 1, 5000);
const samples = integer(options.samples, 100, 2, 1000);
const warmups = integer(options.warmups, 20, 0, 100);
const driver = join(repository, 'packages/cil/tools/benchmark-object-verifier.mjs');
const driverSHA256 = sha(readFileSync(driver));
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
mkdirSync(output);
const order = [];
const comparisons = [];
const captured = {};
const state = { commits, harnessCommit, driverSHA256, iterations, samples, warmups, order, comparisons, complete: false };
const save = () => writeJson(join(output, 'cohort.json'), state);

async function run(side, name) {
  const stem = `${String(order.length + 1).padStart(2, '0')}-${side}-${name}`;
  const file = join(output, stem + '.json');
  const command = [driver, file, '--root', trees[side], '--case', name,
    '--iterations', String(iterations), '--samples', String(samples), '--warmups', String(warmups)];
  const entry = { side, name, startedAt: new Date().toISOString(), command: [process.execPath, ...command], file };
  order.push(entry);
  save();
  try {
    const raw = await execute(process.execPath, command, { cwd: trees[side], signal: controller.signal, timeoutMs: 180000 });
    entry.endedAt = new Date().toISOString();
    entry.exitCode = 0;
    writeJson(join(output, stem + '-process.json'), { exitCode: 0, ...raw });
    const result = JSON.parse(readFileSync(file));
    if (result.commit !== commits[side] || result.harnessCommit !== harnessCommit)
      throw new Error('Checkout identity changed during cohort');
    captured[`${side}/${name}`] = result;
  } catch (error) {
    entry.endedAt = new Date().toISOString();
    entry.failure = error.message;
    writeJson(join(output, stem + '-failure.json'), { message: error.message, code: error.code ?? null,
      exitCode: error.exitCode ?? null, signal: error.signal ?? null,
      stdout: error.stdout ?? null, stderr: error.stderr ?? null });
    throw error;
  } finally {
    save();
  }
}

try {
  for (const [index, name] of controlCases.entries()) {
    for (const side of index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) await run(side, name);
    const before = captured[`baseline/${name}`];
    const after = captured[`candidate/${name}`];
    const baseline = before.benchmarks[0];
    const candidate = after.benchmarks[0];
    if (JSON.stringify(baseline.metrics.identity) !== JSON.stringify(candidate.metrics.identity))
      throw new Error(`Fixture identity mismatch: ${name}`);
    const fixtureInputs = row => Object.entries(row.metrics.provenance.sourceInputs)
      .filter(([path]) => path.startsWith('tests/'));
    if (JSON.stringify(fixtureInputs(baseline)) !== JSON.stringify(fixtureInputs(candidate)))
      throw new Error(`Fixture source or capture mismatch: ${name}`);
    if (baseline.metrics.provenance.nodeExecutable.sha256 !== candidate.metrics.provenance.nodeExecutable.sha256)
      throw new Error('Node executable mismatch');
    if (baseline.correctness.checksum !== candidate.correctness.checksum)
      throw new Error(`Correctness checksum mismatch: ${name}`);
    comparisons.push({ name, baseline: baseline.statistics, candidate: candidate.statistics,
      changePercent: Object.fromEntries(['median', 'p95', 'p99'].map(metric =>
        [metric, 100 * (candidate.statistics[metric] / baseline.statistics[metric] - 1)])) });
    save();
  }
  for (const name of objectCases) await run('candidate', name);
  for (const [side, tree] of Object.entries(trees)) {
    if (clean(tree) !== commits[side]) throw new Error('Measured checkout changed');
  }
  if (clean(repository) !== harnessCommit) throw new Error('Harness changed');
  state.complete = true;
  state.note = 'One predefined cohort. Differences require review; no significance test or automatic gate pass is claimed.';
} finally {
  save();
}
