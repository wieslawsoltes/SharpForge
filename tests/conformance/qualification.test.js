import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {checkoutStatus} from '../../scripts/conformance/clean-checkout.js';
import {checkStatus} from '../../scripts/conformance/ci-status.js';
import {probe} from '../../scripts/conformance/env-report.js';
import {resultPath} from '../../scripts/conformance/results.js';
import {writePlan} from '../../apps/cli/workspace.js';

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'sf-qualification-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}

test('checkout guard rejects tracked, staged and untracked mutations, permits ignored evidence', async t => {
  const root = await temporary(t), git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'});
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  await writeFile(join(root, '.gitignore'), 'artifacts/\n'); await writeFile(join(root, 'source.js'), 'original\n');
  git('add', '.'); git('commit', '-qm', 'fixture');
  await mkdir(join(root, 'artifacts')); await writeFile(join(root, 'artifacts/report.json'), '{}');
  assert.equal(checkoutStatus(root), '');
  await writeFile(join(root, 'source.js'), 'modified\n');
  assert.match(checkoutStatus(root), / M source.js/);
  git('add', 'source.js'); assert.match(checkoutStatus(root), /M  source.js/);
  await writeFile(join(root, 'unexpected.txt'), 'stray'); assert.match(checkoutStatus(root), /\?\? unexpected.txt/);
});

test('stable gate rejects failed, cancelled, skipped, missing and malformed prerequisites', () => {
  checkStatus({core: {result: 'success'}, browser: {result: 'success'}});
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(() => checkStatus({core: {result: 'success'}, browser: {result}}), /browser=/);
  }
  for (const value of [null, {}, [], 'success']) assert.throws(() => checkStatus(value), /Missing/);
});

test('environment capture records unavailable/failed probes instead of claiming installed versions', () => {
  const missing = probe('missing', [], () => ({error: new Error('ENOENT'), status: null}));
  assert.equal(missing.available, false); assert.equal(missing.error, 'ENOENT');
  assert.equal(probe('broken', [], () => ({status: 1, stderr: 'bad'})).available, false);
  const present = probe('working', ['--version'], () => ({status: 0, stdout: 'v1\n'}));
  assert.equal(present.available, true); assert.equal(present.stdout, 'v1');
});

test('results path creates custom directories including spaces and defaults outside tracked docs', async t => {
  const root = await temporary(t);
  const target = await resultPath('nested/result.json', join(root, 'with spaces'));
  await writeFile(target, '{}'); assert.equal(await readFile(target, 'utf8'), '{}');
  assert.match(await resultPath('probe.json', ''), /artifacts[/\\]results[/\\]probe.json$/);
});

test('CLI output accepts a symlinked ancestor, but rejects links at or inside the output root', async t => {
  const root = await temporary(t), real = join(root, 'real'), alias = join(root, 'alias');
  await mkdir(real); await symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const plan = {records: [{path: 'Nested/Program.cs', text: 'Console.WriteLine(42);'}]};
  await writePlan(join(alias, 'New/Workspace'), plan);
  assert.equal(await readFile(join(real, 'New/Workspace/Nested/Program.cs'), 'utf8'), plan.records[0].text);
  await assert.rejects(writePlan(alias, plan), /symbolic link/);
  const output = join(real, 'Empty'), outside = join(real, 'Outside');
  await mkdir(output); await mkdir(outside);
  await symlink(outside, join(output, 'Nested'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(writePlan(output, plan), /empty|symbolic link/);
  assert.deepEqual(await readdir(outside), []);
});

test('browser matrix covers each discovered entry point and every OS without fail-fast', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const runner = await readFile(new URL('./browser/run_suite.py', import.meta.url), 'utf8');
  const entries = (await readdir(new URL('../', import.meta.url))).filter(name => /^browser_.*test\.py$/.test(name) || name === 'standalone_test.py');
  assert.equal(entries.length, 15);
  for (const name of entries) {
    const source = await readFile(new URL('../' + name, import.meta.url), 'utf8');
    assert.match(source, /launch_browser\(p, __file__\)/, name);
    assert.doesNotMatch(source, /p\.chromium\.launch|ROOT\s*\/\s*['"]docs/);
    if (!name.startsWith('browser_release')) assert.ok(runner.includes(name), name);
  }
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(workflow, /suite: \[browser, managed, workspace, release05, release06, msbuild, release08, native-explorer, release09, release10, release11, release12, release13, release14, standalone\]/);
  assert.match(workflow, /needs: \[core, core-platforms, build, packages, browser, native-il, native-msbuild, clr-wasm\]/);
});

test('managed Int32 process exits use Windows DWORD and POSIX low-byte representations', async () => {
  const {nativeExitStatus} = await import('../../scripts/conformance/native-exit-status.js');
  for (const [code, windows, posix] of [[0, 0, 0], [42, 42, 42], [256, 256, 0], [-3, 4294967293, 253], [-2, 4294967294, 254], [-2147483648, 2147483648, 0], [2147483647, 2147483647, 255]]) {
    assert.equal(nativeExitStatus(code, 'win32'), windows);
    for (const platform of ['linux', 'darwin']) assert.equal(nativeExitStatus(code, platform), posix);
  }
  for (const code of [NaN, Infinity, 1.5, '42', -2147483649, 2147483648]) assert.throws(() => nativeExitStatus(code), /Int32/);
});

test('checkout attributes override autocrlf for executable/example text without altering binary bytes', async t => {
  const root = await temporary(t), git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'});
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  git('config', 'core.autocrlf', 'true'); git('config', 'core.eol', 'crlf');
  await writeFile(join(root, '.gitattributes'), await readFile(new URL('../../.gitattributes', import.meta.url)));
  const sources = {'runner.js': Buffer.from('#!/usr/bin/env node\nconsole.log(42);\n'), 'Program.cs': Buffer.from('Console.WriteLine(42);\n'), 'opaque.bin': Buffer.from([0, 255, 13, 10, 0, 10])};
  for (const [name, bytes] of Object.entries(sources)) await writeFile(join(root, name), bytes);
  git('add', '.'); git('commit', '-qm', 'cross-platform checkout fixture');
  for (const name of Object.keys(sources)) await rm(join(root, name));
  git('checkout', '--', '.');
  for (const [name, bytes] of Object.entries(sources)) assert.deepEqual(await readFile(join(root, name)), bytes, name);
  assert.equal(checkoutStatus(root), '');
});


test('ordinary PRs have one core job while full qualification and releases remain explicit', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const release = await readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  const jobs = new Map([...workflow.matchAll(/^  ([a-z][a-z-]*):\n([\s\S]*?)(?=^  [a-z][a-z-]*:\n|$(?![\s\S]))/gm)].filter(match => workflow.indexOf(match[0]) > workflow.indexOf('jobs:')).map(match => [match[1], match[2]]));
  assert.deepEqual([...jobs.keys()], ['core','core-platforms','build','packages','browser','native-il','native-msbuild','clr-wasm','ci-ok']);
  const full = "inputs.qualification || github.event_name == 'workflow_dispatch' || github.event_name == 'merge_group' || contains(github.event.pull_request.labels.*.name, 'full-ci')";
  const core = jobs.get('core');
  assert.match(core, /^    runs-on: ubuntu-latest$/m);
  assert.doesNotMatch(core, /^    (if|strategy):/m);
  for (const command of ['npm run check','npm test','npm run build']) assert.ok(core.includes(`run: ${command}\n`), command);
  assert.doesNotMatch(core, /run: npm run (test:packages|test:dotnet|test:browser|bench)/);
  assert.ok(core.includes('run: npm test\n        if: '+full+'\n'));
  assert.ok(core.includes('if: '+full+"\n        run: python -m unittest discover -s tests/conformance/browser -p 'test_*.py'"));
  assert.doesNotMatch(core, /node --test/);
  assert.match(core, /if: always\(\)\n        run: node scripts\/conformance\/clean-checkout.js/);
  for (const [name, job] of jobs) if (name !== 'core') {
    const condition = job.match(/^    if: (.+)$/m)?.[1];
    assert.equal(condition, name === 'ci-ok' ? '${{ always() && ('+full+') }}' : full, name);
  }
  assert.match(jobs.get('core-platforms'), /os: \[windows-latest, macos-latest\]/);
  assert.match(workflow, /push:\n    branches: \[main\]/);
  assert.match(workflow, /pull_request:\n    types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
  for (const event of ['workflow_dispatch','merge_group','workflow_call']) assert.match(workflow, new RegExp('^  '+event+':','m'));
  assert.match(workflow, /github.event.pull_request.number \|\| github.ref/);
  assert.match(release, /qualification:\n    needs: policy\n    uses: \.\/\.github\/workflows\/ci.yml/);
  assert.match(release, /uses: \.\/\.github\/workflows\/ci.yml\n    with:\n      qualification: true/);
  assert.match(release, /needs: qualification/);
});
