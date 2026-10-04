import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runGitCLI } from '../../apps/cli/git.js';
import { startGitHttpFixture } from '../../packages/git/bench/git-http-fixture.js';
import { createGitProxy } from '../../packages/git/proxy/server.js';

export async function invokeCLI(workspace, argv, context = {}) {
  let stdout = '';
  let stderr = '';
  const code = await runGitCLI(argv, {
    cwd: workspace.root, env: workspace.env,
    stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } }, ...context
  });
  return { code, stdout, stderr };
}

async function compareState(workspace, directories, report, label) {
  const [native, sharp] = directories;
  for (const args of [['rev-parse', 'HEAD'], ['ls-files', '--stage', '-z']]) {
    const actual = await workspace.git(args, { cwd: sharp });
    const expected = await workspace.git(args, { cwd: native });
    report.equal('cli-state', `${label} ${args[0]}`, actual.stdout, expected.stdout);
  }
  const paths = (await workspace.git(['ls-files', '-z'], { cwd: native })).stdout.toString().split('\0').filter(Boolean);
  for (const path of paths) report.equal('worktree', `${label} ${path}`, await readFile(join(sharp, path)), await readFile(join(native, path)));
}

async function createRemote(workspace, algorithm) {
  const directory = join(workspace.root, 'seed');
  await mkdir(directory);
  await workspace.git(['init', '-q', '--initial-branch=main', `--object-format=${algorithm}`], { cwd: directory });
  await workspace.write(directory, 'tracked.txt', 'first line\nsecond line\n');
  await workspace.write(directory, 'nested/binary.bin', Buffer.from([0, 255, 128, 10, 4]));
  await workspace.git(['add', '-A'], { cwd: directory });
  await workspace.git(['commit', '-q', '-m', 'initial fixture'], { cwd: directory });
  await workspace.git(['clone', '-q', '--bare', directory, 'repository.git']);
  await workspace.git(['config', 'http.receivepack', 'true'], { cwd: join(workspace.root, 'repository.git') });
}

async function localScenario(workspace, directories, network, report) {
  const [native, sharp] = directories;
  for (const directory of directories) {
    await workspace.write(directory, 'tracked.txt', 'first line\nchanged second line\n');
    await workspace.write(directory, 'new.txt', 'newly tracked\n');
  }
  const status = await invokeCLI(workspace, ['-C', sharp, 'status', '--porcelain=v2', '-z']);
  report.equal('status', 'CLI exit', status.code, 0);
  report.equal('status', 'porcelain v2', status.stdout, (await workspace.git(['status', '--porcelain=v2', '-z'], { cwd: native })).stdout.toString());
  const diff = await invokeCLI(workspace, ['-C', sharp, 'diff', '--name-status', '--no-renames']);
  report.equal('diff', 'CLI exit', diff.code, 0);
  report.equal('diff', 'working tree names', diff.stdout, (await workspace.git(['diff', '--name-status', '--no-renames'], { cwd: native })).stdout.toString());
  const add = await invokeCLI(workspace, ['-C', sharp, 'add', '-A']);
  report.equal('add', 'CLI exit', add.code, 0);
  await workspace.git(['add', '-A'], { cwd: native });
  await compareState(workspace, directories, report, 'staged');
  const commit = await invokeCLI(workspace, ['-C', sharp, 'commit', '-m', 'identical next commit']);
  report.equal('commit', 'CLI exit', { code: commit.code, stderr: commit.stderr }, { code: 0, stderr: '' });
  await workspace.git(['commit', '-q', '-m', 'identical next commit'], { cwd: native });
  await compareState(workspace, directories, report, 'committed');
  const log = await invokeCLI(workspace, ['-C', sharp, 'log', '--json']);
  report.equal('log', 'CLI commit history', JSON.parse(log.stdout).map(item => item.oid),
    (await workspace.git(['log', '--format=%H'], { cwd: native })).text.split('\n'));
  const push = await invokeCLI(workspace, ['-C', sharp, 'push', 'origin', 'main:main', ...network]);
  report.equal('push', 'CLI fast-forward', { code: push.code, stderr: push.stderr }, { code: 0, stderr: '' });
  report.equal('push', 'native receiver ref', (await workspace.git(['rev-parse', 'main'], { cwd: join(workspace.root, 'repository.git') })).text,
    (await workspace.git(['rev-parse', 'HEAD'], { cwd: native })).text);
  await workspace.git(['push', '-q', 'origin', 'main'], { cwd: native });
}

async function proxyScenario(workspace, server, report, algorithm) {
  const clientOrigin = 'https://studio.example.test';
  const proxy = createGitProxy({ upstreamOrigins: [server.origin], clientOrigins: [clientOrigin], allowInsecureLocalhost: true });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  const proxyOrigin = `http://127.0.0.1:${proxy.address().port}`;
  try {
    const result = await invokeCLI(workspace, ['clone', `${server.origin}/repository.git`, 'proxy-clone', '--object-format', algorithm,
      '--allow-origin', server.origin, '--allow-origin', proxyOrigin, '--allow-insecure-localhost', '--proxy', `${proxyOrigin}/git`], {
      fetch: (url, options) => {
        const headers = new Headers(options.headers);
        headers.set('origin', clientOrigin);
        return fetch(url, { ...options, headers });
      }
    });
    report.equal('proxy', 'clone through explicit proxy', { code: result.code, stderr: result.stderr }, { code: 0, stderr: '' });
    report.equal('proxy', 'checked-out worktree', await readFile(join(workspace.root, 'proxy-clone', 'tracked.txt'), 'utf8'),
      await readFile(join(workspace.root, 'sharp-clone', 'tracked.txt'), 'utf8'));
  } finally {
    await new Promise((resolve, reject) => { proxy.close(error => error ? reject(error) : resolve()); proxy.closeAllConnections(); });
  }
}

export async function runCLIConformance(workspace, report, algorithm = 'sha1') {
  await createRemote(workspace, algorithm);
  const server = await startGitHttpFixture({ directory: workspace.root, env: workspace.env });
  const network = ['--allow-origin', server.origin, '--allow-insecure-localhost'];
  const format = ['--object-format', algorithm];
  try {
    const url = `${server.origin}/repository.git`;
    await workspace.git(['clone', '-q', url, 'native-clone']);
    const clone = await invokeCLI(workspace, ['clone', url, 'sharp-clone', ...format, ...network]);
    report.equal('clone', 'CLI clone', { code: clone.code, stderr: clone.stderr }, { code: 0, stderr: '' });
    const directories = ['native-clone', 'sharp-clone'].map(name => join(workspace.root, name));
    report.equal('object-format', 'native-readable CLI object format',
      (await workspace.git(['rev-parse', '--show-object-format'], { cwd: directories[1] })).text, algorithm);
    await compareState(workspace, directories, report, 'cloned');
    const occupied = await invokeCLI(workspace, ['clone', url, 'sharp-clone', ...format, ...network]);
    report.equal('clone', 'reject occupied destination', occupied.code, 1);
    const denied = await invokeCLI(workspace, ['clone', url, 'denied-clone', ...format, '--allow-insecure-localhost']);
    report.equal('clone', 'reject ungranted origin', JSON.parse((await invokeCLI(workspace,
      ['clone', url, 'denied-json', ...format, '--json', '--allow-insecure-localhost'])).stderr).code, 'Auth');
    report.equal('clone', 'ungranted exit', denied.code, 1);
    await localScenario(workspace, directories, network, report);
    await proxyScenario(workspace, server, report, algorithm);
  } finally { await server.close(); }
}
