import { spawnSync } from 'node:child_process';
import { openSync, closeSync, writeFileSync, readFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const candidate = '/tmp/sharpforge-project6-a03-dataflow';
const baseline = '/tmp/sharpforge-project6-a03-dataflow-baseline';
const parent = 'bf5ed78110a864d9771849ac7845f0139d1986c4';
const headPrefix = 'a1263d5ae';
const evidence = '/tmp/a03-dataflow-validation';
const node = process.execPath;
if (!process.version.startsWith('v24.')) throw new Error('Qualification requires pinned Node 24');
const tests = [
  'tests/a03-verifier-dataflow.test.js',
  'tests/a03-verification-types.test.js',
  'tests/a03-07-handler-entry.test.js',
  'tests/a03-07-eh-admission.test.js',
  'tests/a03-07-no-handler-placement.test.js',
  'tests/managed-il.test.js',
  'tests/a05-09-verified-stack.test.js',
  'tests/a05-cil-stack-byte-budget.test.js',
  'tests/a05-managed-calli.test.js',
  'tests/a05-calli-stack-byte-budget.test.js',
];
const start = Number(process.argv[2] ?? 0);
if (!Number.isInteger(start) || start < 0 || start > 10) throw new Error('Expected resume step 0..10');
if (process.env.SHARPFORGE_TEST_CONCURRENCY !== '1' || process.env.SHARPFORGE_MAX_PARALLEL_RUNS !== '1' ||
    process.env.SHARPFORGE_MAX_OLD_SPACE_MB !== '1024') throw new Error('Serial 1/1 GiB controls required');
mkdirSync(evidence, { recursive: true });
const trace = [];
function command(command, args, cwd, log, expected = 0) {
  const entry = { command, args, cwd, started: new Date().toISOString() };
  trace.push(entry);
  console.log(JSON.stringify({ start: log, ...entry }));
  const fd = openSync(join(evidence, log + '.log'), 'wx');
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  Object.assign(entry, { completed: new Date().toISOString(), status: result.status, signal: result.signal,
    error: result.error?.message, log });
  writeFileSync(join(evidence, 'driver-' + start + '.json'), JSON.stringify(trace, null, 2) + '\n');
  console.log(JSON.stringify({ terminal: log, status: result.status, signal: result.signal, error: result.error?.message }));
  if (result.error || result.status !== expected || result.signal) process.exit(result.status || 1);
}
function git(args) {
  const result = spawnSync('git', args, { cwd: candidate, encoding: 'utf8' });
  if (result.status) throw new Error(result.stderr);
  return result.stdout.trim();
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const steps = [
  () => {
    if (existsSync(baseline)) throw new Error('Inspect existing baseline before resuming');
    const head = git(['rev-parse', 'HEAD']);
    if (!head.startsWith(headPrefix)) throw new Error('Candidate changed before qualification');
    if (git(['status', '--porcelain=v1'])) throw new Error('Dirty candidate');
    command('git', ['-c', 'gc.auto=0', 'worktree', 'add', '--detach', baseline, parent], candidate, '00-baseline');
    const copied = {};
    for (const file of ['tests/fixtures/verifier-dataflow/input.js', 'tests/fixtures/verifier-dataflow/baseline.mjs']) {
      mkdirSync(dirname(join(baseline, file)), { recursive: true });
      copyFileSync(join(candidate, file), join(baseline, file));
      copied[file] = sha(readFileSync(join(candidate, file)));
    }
    const controls = {};
    for (const file of ['packages/cil/tools/benchmark-handler-entry.mjs', 'tests/fixtures/a03-handler-entry/input.js']) {
      const digest = sha(readFileSync(join(candidate, file)));
      if (sha(readFileSync(join(baseline, file))) !== digest) throw new Error('Control differs: ' + file);
      controls[file] = digest;
    }
    writeFileSync(join(evidence, 'source-proof.json'), JSON.stringify({ parent, candidate: head, copied, controls }, null, 2) + '\n');
  },
  () => command('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], candidate, '01-install-candidate-node24'),
  () => command('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], baseline, '02-install-baseline-node24'),
  () => {
    command(node, ['tests/fixtures/verifier-dataflow/baseline.mjs'], baseline, '03-failing-before-node24', 1);
    const output = readFileSync(join(evidence, '03-failing-before-node24.log'), 'utf8');
    if (!output.includes('A zero dataflow budget must prevent a successful stack proof') || !output.includes('true !== false'))
      throw new Error('Unexpected red proof');
  },
  () => command(node, ['tests/fixtures/verifier-dataflow/capture.mjs',
    'tests/fixtures/verifier-dataflow/native.json'], candidate, '04-native-pinned'),
  () => command(node, ['--test', '--test-concurrency=1', ...tests], candidate, '05-focused'),
  () => command(node, ['--expose-gc', 'packages/cil/tools/benchmark-handler-entry.mjs',
    join(evidence, 'baseline.json')], baseline, '06-benchmark-baseline'),
  () => command(node, ['--expose-gc', 'packages/cil/tools/benchmark-handler-entry.mjs',
    join(evidence, 'candidate.json')], candidate, '07-benchmark-candidate'),
  () => command('/tmp/sharpforge-bcl-browser-venv/bin/python', ['/tmp/a03-dataflow-browser.py', candidate, join(evidence, 'browser')], candidate, '08-browser'),
  () => command('npm', ['run', 'check'], candidate, '09-check'),
  () => command('npm', ['run', 'check:structure'], candidate, '10-structure'),
];
for (let index = start; index < steps.length; index++) steps[index]();
console.log('All dataflow qualification steps are terminal.');
