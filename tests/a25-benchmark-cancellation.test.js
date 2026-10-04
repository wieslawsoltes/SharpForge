import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter, getEventListeners } from 'node:events';
import { PassThrough } from 'node:stream';
import { benchmarkGit } from '../packages/git/bench/native.js';
import { generateBenchmarkRepository } from '../packages/git/bench/generate.js';
import { benchmarkReadOperations } from '../packages/git/bench/read-operations.js';
import { measureOperation, directoryStatistics, compareBenchmarkBaseline } from '../packages/git/bench/metrics.js';
import { LARGE_REPOSITORY_PROFILE, runLargeRepositoryBenchmark } from '../packages/git/bench/large-repo.js';
import { writeBenchmarkReport } from '../packages/git/bench/report.js';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-benchmark-cancellation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function commandRecorder() {
  const calls = [];
  return {
    calls,
    async runGit(args, options) {
      calls.push({ args, signal: options.signal });
      return args[0] === '--version' ? 'fixture command adapter' : '';
    }
  };
}

test('an already-aborted native benchmark command rejects before spawning a child', async () => {
  const controller = new AbortController();
  controller.abort();
  let spawned = 0;
  await assert.rejects(benchmarkGit(['--version'], {
    signal: controller.signal,
    spawnChild() {
      spawned++;
      throw new Error('A cancelled command must not spawn');
    }
  }), { code: 'Cancelled' });
  assert.equal(spawned, 0);
});

test('cancellation during native child creation is rechecked and releases the deadline and listener', async t => {
  const controller = new AbortController();
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let killed = 0;
  child.kill = signal => {
    assert.equal(signal, 'SIGKILL');
    killed++;
    child.stdout.destroy();
    child.stderr.destroy();
    queueMicrotask(() => child.emit('close', null));
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await assert.rejects(benchmarkGit(['--version'], {
    signal: controller.signal,
    spawnChild() {
      controller.abort();
      return child;
    }
  }), { code: 'Cancelled' });
  assert.equal(killed, 1);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  t.mock.timers.tick(30 * 60_000);
  assert.equal(killed, 1);
});

test('already-aborted generation creates no fixture and starts no native commands', async t => {
  const root = await temporaryDirectory(t);
  const controller = new AbortController();
  controller.abort();
  const commands = commandRecorder();
  await assert.rejects(generateBenchmarkRepository(root, { files: 1, binaryBytes: 0, history: 1, algorithm: 'sha1' }, {
    signal: controller.signal, runGit: commands.runGit
  }), { code: 'Cancelled' });
  assert.deepEqual(await readdir(root), []);
  assert.deepEqual(commands.calls, []);
});

test('cancellation after a text batch prevents further files, binaries, and native staging', async t => {
  const root = await temporaryDirectory(t);
  const controller = new AbortController();
  const commands = commandRecorder();
  await assert.rejects(generateBenchmarkRepository(root, { files: 65, binaryBytes: 8, history: 2, algorithm: 'sha1' }, {
    signal: controller.signal, runGit: commands.runGit,
    onProgress(event) { if (event.phase === 'generate-files') controller.abort(); }
  }), { code: 'Cancelled' });
  assert.equal((await readdir(join(root, 'source', 'text', '000'))).length, 32);
  await assert.rejects(stat(join(root, 'source', 'binary')), { code: 'ENOENT' });
  assert.deepEqual(commands.calls.map(call => call.args[0]), ['--version', 'init', 'config', 'config']);
  assert.ok(commands.calls.every(call => call.signal === controller.signal));
});

test('cancellation after binary generation prevents staging and closes the output file', async t => {
  const root = await temporaryDirectory(t);
  const controller = new AbortController();
  const commands = commandRecorder();
  await assert.rejects(generateBenchmarkRepository(root, { files: 1, binaryBytes: 8, history: 1, algorithm: 'sha1' }, {
    signal: controller.signal, runGit: commands.runGit,
    onProgress(event) { if (event.phase === 'generate-binary') controller.abort(); }
  }), { code: 'Cancelled' });
  assert.equal((await stat(join(root, 'source', 'binary', 'part-0000.bin'))).size, 8);
  assert.equal(commands.calls.some(call => call.args[0] === 'add'), false);
  await rm(join(root, 'source'), { recursive: true });
});

test('read phases forward the exact cancellation signal and recheck it after awaiting the repository', async () => {
  for (const name of ['status', 'log', 'blame']) {
    const controller = new AbortController();
    let called = 0;
    const repo = {
      async [name](...args) {
        called++;
        assert.equal(args.at(-1).signal, controller.signal);
        controller.abort();
        return name === 'status' ? [] : new Array(name === 'log' ? 1 : 8);
      }
    };
    await assert.rejects(benchmarkReadOperations[name](repo, { history: 1 }, { signal: controller.signal }), { code: 'Cancelled' });
    assert.equal(called, 1);
    await assert.rejects(benchmarkReadOperations[name](repo, { history: 1 }, { signal: controller.signal }), { code: 'Cancelled' });
    assert.equal(called, 1);
  }
});

test('cancelled measurement and storage phases stop before effects and retain no timer', async t => {
  const controller = new AbortController();
  controller.abort();
  let called = 0;
  t.mock.timers.enable({ apis: ['setInterval'] });
  await assert.rejects(measureOperation(() => { called++; }, { signal: controller.signal }), { code: 'Cancelled' });
  await assert.rejects(directoryStatistics('path-that-must-not-be-read', { signal: controller.signal }), { code: 'Cancelled' });
  assert.equal(called, 0);
  t.mock.timers.tick(1000);
});

test('a later cancellation retains a real completed native clone sample without qualifying the full profile', async t => {
  const directory = await temporaryDirectory(t);
  const controller = new AbortController();
  let partial;
  await assert.rejects(runLargeRepositoryBenchmark({
    directory, files: 3, binaryBytes: 0, history: 2, samples: 1, signal: controller.signal,
    onProgress(event) { if (event.phase === 'status.cold') controller.abort(); }
  }), error => {
    partial = error.report;
    assert.equal(error.code, 'Cancelled');
    assert.equal(error.cause.code, 'Cancelled');
    return true;
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.complete, false);
  assert.equal(partial.failure.phase, 'status.cold');
  assert.equal(partial.measurements.clone.samples, 1);
  assert.equal(partial.measurements.clone.raw.length, 1);
  assert.ok(partial.measurements.clone.raw[0].milliseconds > 0);
  assert.ok(partial.measurements.clone.raw[0].objectOperations.write > 0);
  assert.equal(partial.measurements['status.cold'], undefined);
  assert.deepEqual(partial.profile, { files: 3, binaryBytes: 0, history: 2, samples: 1, algorithm: 'sha1' });
  assert.equal(partial.fixture.textFiles, 3);
  assert.deepEqual(await readdir(directory), []);
  assert.equal(LARGE_REPOSITORY_PROFILE.files, 100_000);
  assert.equal(LARGE_REPOSITORY_PROFILE.binaryBytes, 1024 ** 3);
  assert.equal(LARGE_REPOSITORY_PROFILE.samples, 3);
  const output = join(directory, 'partial.json');
  const json = await writeBenchmarkReport(partial, output);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), JSON.parse(json));
  assert.equal(JSON.parse(json).ok, false);
  assert.equal(json.includes('"cause"'), false);
  assert.throws(() => compareBenchmarkBaseline(partial, partial), /incomplete/);
});
