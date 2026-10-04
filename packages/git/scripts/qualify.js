import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmarkGit } from '../bench/native.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const GIT_QUALIFICATION_SCOPES = Object.freeze(['node', 'pack-memory', 'benchmark']);

/** Package-owned serial job registry. The surrounding CI workflow remains owned by its existing maintainer. */
export function createQualificationPlan(files, options = {}) {
  const selected = options.scopes ?? GIT_QUALIFICATION_SCOPES;
  if (!Array.isArray(selected) || !selected.length || selected.some(scope => !GIT_QUALIFICATION_SCOPES.includes(scope))) {
    throw new Error('Qualification scope must be node, pack-memory or benchmark');
  }
  if (options.requireBaseline && !options.baseline) throw new Error('An explicit measured baseline is required for this qualification');
  const output = resolve(options.output ?? '.');
  const tests = files.filter(name => /^a25-[A-Za-z0-9_.-]+\.test\.js$/.test(name)).sort().map(name => `tests/${name}`);
  if (selected.includes('node') && !tests.length) throw new Error('The Git qualification registry contains no focused Node tests');
  const definitions = {
    node: ['--test', '--test-concurrency=1', ...tests],
    'pack-memory': ['packages/git/bench/pack-memory.js', '--output', join(output, 'pack-memory.json')],
    benchmark: ['packages/git/scripts/benchmark.js', '--output', join(output, 'benchmark.json'),
      ...options.baseline ? ['--baseline', resolve(options.baseline)] : []]
  };
  return GIT_QUALIFICATION_SCOPES.filter(name => selected.includes(name)).map(name => ({
    name, command: process.execPath, args: ['scripts/limited.js', process.execPath, ...definitions[name]], cwd: repositoryRoot
  }));
}

function runStage(stage, onProgress) {
  return new Promise(resolveStage => {
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const child = spawn(stage.command, stage.args, { cwd: stage.cwd, stdio: 'inherit', windowsHide: true });
    let failure;
    const interrupt = signal => child.kill(signal);
    const interruptInt = () => interrupt('SIGINT');
    const interruptTerm = () => interrupt('SIGTERM');
    process.once('SIGINT', interruptInt);
    process.once('SIGTERM', interruptTerm);
    child.on('error', error => { failure = error.message; });
    child.on('close', (code, signal) => {
      process.removeListener('SIGINT', interruptInt);
      process.removeListener('SIGTERM', interruptTerm);
      const result = { name: stage.name, startedAt, finishedAt: new Date().toISOString(),
        milliseconds: performance.now() - start, exitCode: code, signal, ok: code === 0 && !failure,
        ...(failure ? { error: failure } : {}) };
      onProgress?.(result);
      resolveStage(result);
    });
  });
}

/** Run only requested complete scopes, strictly in sequence; stop after a failure and retain the exact source and commands. */
export async function runGitQualification(options = {}) {
  if (!options.output) throw new Error('Qualification requires --output DIRECTORY for retained reports');
  const output = resolve(options.output);
  const plan = createQualificationPlan(await readdir(join(repositoryRoot, 'tests')), { ...options, output });
  const report = { schema: 'sharpforge.git.qualification.v1', source: await benchmarkGit(['rev-parse', 'HEAD'], { cwd: repositoryRoot }),
    scopes: plan.map(stage => stage.name), plan, stages: [], ok: false,
    baseline: options.baseline ? { path: resolve(options.baseline), status: 'comparison-requested' } : { status: 'candidate-only' },
    workflowIntegration: 'Package-owned entry only; shared CI workflow registration and baseline review are externally owned' };
  await mkdir(output, { recursive: true });
  const save = () => writeFile(join(output, 'qualification.json'), `${JSON.stringify(report, null, 2)}\n`);
  await save();
  for (const stage of plan) {
    options.onProgress?.({ name: stage.name, phase: 'starting' });
    report.stages.push(await runStage(stage, options.onProgress));
    await save();
    if (!report.stages.at(-1).ok) return report;
  }
  report.ok = true;
  if (options.baseline && report.scopes.includes('benchmark')) report.baseline.status = 'compared';
  await save();
  return report;
}

function parseOptions(argv) {
  const options = {};
  const names = { '--scope': 'scopes', '--output': 'output', '--baseline': 'baseline' };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--require-baseline') { options.requireBaseline = true; continue; }
    if (flag === '--list') { options.list = true; continue; }
    if (!names[flag] || argv[index + 1] === undefined) throw new Error(`Invalid qualification option ${flag}`);
    const value = argv[++index];
    options[names[flag]] = flag === '--scope' ? (value === 'all' ? undefined : value.split(',')) : value;
  }
  return options;
}

export async function qualificationMain(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: qualify.js --output DIRECTORY [--scope all|node|pack-memory|benchmark]\n'
      + '  [--baseline REPORT.json] [--require-baseline] [--list]\n'
      + 'Each stage invokes scripts/limited.js itself. Run this coordinator directly, without an outer limited.js slot.\n');
    return 0;
  }
  const options = parseOptions(argv);
  if (options.list) {
    const plan = createQualificationPlan(await readdir(join(repositoryRoot, 'tests')), options);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  }
  const report = await runGitQualification({ ...options,
    onProgress: value => process.stderr.write(`SHARPFORGE_GIT_QUALIFICATION_PROGRESS ${JSON.stringify(value)}\n`) });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await qualificationMain();
