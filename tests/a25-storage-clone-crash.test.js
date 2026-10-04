import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CLONE_CHECKPOINTS, CLONE_JOURNAL_KEY } from '../packages/git/src/index.js';
import { startGitHttpFixture } from '../packages/git/bench/git-http-fixture.js';
import { fixtureWorkspace, gitAvailability } from './git-conformance/native.js';

function startWorker(workerData, signal) {
  if (signal?.aborted) throw new Error('Clone crash qualification was cancelled');
  const worker = new Worker(new URL('./git-conformance/clone-crash-worker.js', import.meta.url), {
    workerData, resourceLimits: { maxOldGenerationSizeMb: 256 }
  });
  let complete;
  let fail;
  let received = false;
  const result = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
  const abort = () => {
    fail(new Error('Clone crash qualification was cancelled'));
    void worker.terminate();
  };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    fail(new Error(`Clone ${workerData.action} worker exceeded its 60 second deadline`));
    void worker.terminate();
  }, 60_000);
  worker.on('message', message => {
    if (received) return;
    received = true;
    if (message.type === 'error') fail(new Error(`${message.error.code}: ${message.error.message}`));
    else complete(message);
  });
  worker.once('error', error => { clearTimeout(timer); fail(error); });
  const exited = new Promise(resolve => worker.once('exit', code => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (!received) fail(new Error(`Clone worker exited ${code} before reporting its durable state`));
    resolve(code);
  }));
  return { worker, result, exited };
}

async function interruptClone(options, signal) {
  const session = startWorker({ ...options, action: 'interrupt' }, signal);
  try {
    const checkpoint = await session.result;
    assert.equal(checkpoint.type, 'checkpoint');
    assert.equal(checkpoint.phase, options.phase);
    assert.equal(checkpoint.persistedPhase, options.phase);
    assert.equal(checkpoint.backend, 'node-filesystem');
    assert.ok(checkpoint.threadId > 0);
    const exitCode = await session.worker.terminate();
    assert.equal(exitCode, 1, 'The worker was terminated before normal clone cleanup');
    assert.equal(await session.exited, exitCode);
    return { ...checkpoint, exitCode };
  } finally { await session.worker.terminate(); }
}

async function finishWorker(options, signal) {
  const session = startWorker(options, signal);
  try {
    const response = await session.result;
    assert.equal(response.type, 'result');
    assert.equal(await session.exited, 0);
    assert.equal(response.result.backend, 'node-filesystem');
    return response.result;
  } finally { await session.worker.terminate(); }
}

async function createSource(workspace) {
  const directory = join(workspace.root, 'source');
  await mkdir(directory);
  const git = args => workspace.git(args, { cwd: directory });
  await git(['init', '-q', '--initial-branch=main', '--object-format=sha1']);
  const files = new Map([
    ['README.md', Buffer.from('Native clone recovery fixture\n')],
    ['nested/space name.txt', Buffer.from('Durable text before worker termination\n')],
    ['nested/binary.bin', Buffer.from([0, 255, 128, 10, 4, 0, 17])]
  ]);
  for (const [path, data] of files) await workspace.write(directory, path, data);
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', 'Native recovery baseline']);
  await git(['branch', 'side']);
  await git(['tag', '-a', 'v1', '-m', 'Recovery fixture tag']);
  files.set('README.md', Buffer.from('Native clone recovery fixture\nSecond commit\n'));
  await workspace.write(directory, 'README.md', files.get('README.md'));
  await git(['add', 'README.md']);
  await git(['commit', '-q', '-m', 'Native recovery tip']);
  await workspace.git(['clone', '-q', '--bare', directory, 'repository.git']);
  return { directory, files, head: (await git(['rev-parse', 'HEAD'])).text,
    index: (await git(['ls-files', '--stage', '-z'])).stdout };
}

async function verifyNativeClone(workspace, directory, source, url) {
  const git = args => workspace.git(args, { cwd: directory });
  assert.equal((await git(['rev-parse', 'HEAD'])).text, source.head);
  assert.equal((await git(['symbolic-ref', 'HEAD'])).text, 'refs/heads/main');
  assert.deepEqual((await git(['ls-files', '--stage', '-z'])).stdout, source.index);
  assert.equal((await git(['status', '--porcelain=v1'])).text, '');
  assert.equal((await git(['config', '--get', 'remote.origin.url'])).text, url);
  assert.equal((await git(['fsck', '--full'])).code, 0);
  for (const [path, bytes] of source.files) assert.deepEqual(await readFile(join(directory, path)), bytes, path);
}

test('actual worker termination at all ten durable clone checkpoints supports cleanup and verified resume',
  { timeout: 240_000 }, async context => {
    const availability = await gitAvailability();
    if (!availability.available) { context.skip(availability.reason); return; }
    context.diagnostic(availability.version);
    const workspace = await fixtureWorkspace('sharpforge-git-clone-crash-');
    let server;
    const checkpoints = [];
    try {
      const source = await createSource(workspace);
      server = await startGitHttpFixture({ directory: workspace.root, env: workspace.env });
      const url = `${server.origin}/repository.git`;
      for (const phase of CLONE_CHECKPOINTS) {
        const directory = join(workspace.root, `interrupted-${phase}`);
        const interrupted = await interruptClone({ directory, url, phase }, context.signal);
        const persisted = JSON.parse(await readFile(join(directory, '.git', CLONE_JOURNAL_KEY), 'utf8'));
        assert.equal(persisted.phase, phase);
        assert.equal(persisted.url, url);
        assert.equal(persisted.algorithm, 'sha1');
        const cleanupDirectory = join(workspace.root, `cleanup-${phase}`);
        await cp(directory, cleanupDirectory, { recursive: true });
        const cleaned = await finishWorker({ action: 'cleanup', directory: cleanupDirectory, url }, context.signal);
        assert.equal(cleaned.recovered, true, phase);
        assert.equal(cleaned.phase, phase);
        assert.deepEqual(cleaned.metadata, persisted.baseline, `${phase}: restore exact pre-clone bytes`);
        assert.equal(cleaned.head, null);
        assert.equal(cleaned.objects, 0);
        assert.deepEqual(cleaned.paths, []);
        assert.equal(cleaned.journal, null);
        const verified = CLONE_CHECKPOINTS.indexOf(phase) >= CLONE_CHECKPOINTS.indexOf('verified');
        const resumed = await finishWorker({ action: 'resume', directory, url, noNetwork: verified }, context.signal);
        assert.notEqual(resumed.threadId, interrupted.threadId, 'Recovery runs in a fresh worker');
        assert.equal(resumed.recoveredPhase, phase);
        assert.equal(resumed.resumed, true);
        assert.equal(resumed.head, source.head);
        assert.equal(resumed.symbolicHead, 'refs/heads/main');
        assert.equal(resumed.remote, url);
        assert.equal(resumed.journal, null);
        assert.deepEqual(resumed.status, []);
        assert.deepEqual(resumed.paths, [...source.files.keys()].sort());
        assert.ok(resumed.refs.some(ref => ref.name === 'refs/remotes/origin/side'));
        assert.ok(resumed.refs.some(ref => ref.name === 'refs/tags/v1'));
        if (verified) assert.equal(resumed.requests, 0, `${phase}: verified recovery reuses durable objects`);
        else assert.ok(resumed.requests > 0, `${phase}: incomplete transfer is fetched again`);
        await verifyNativeClone(workspace, directory, source, url);
        checkpoints.push({ phase, workerExit: interrupted.exitCode, interruptedThread: interrupted.threadId,
          cleanupThread: cleaned.threadId, resumedThread: resumed.threadId, recovered: cleaned.recovered,
          backend: resumed.backend, networkRequests: resumed.requests, objects: resumed.objects, nativeFsck: true });
      }
      assert.equal(checkpoints.length, CLONE_CHECKPOINTS.length);
      context.diagnostic(`SHARPFORGE_GIT_CLONE_CRASH ${JSON.stringify({ version: 1, reference: availability.version, checkpoints })}`);
    } finally {
      try { await server?.close(); }
      finally { await workspace.dispose(); }
    }
  });
