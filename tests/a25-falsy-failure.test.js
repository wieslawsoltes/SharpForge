import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLargeRepositoryBenchmark } from '../packages/git/bench/large-repo.js';
import { GitError } from '../packages/git/src/errors.js';
import { readPack } from '../packages/git/src/pack/reader.js';
import { writePack } from '../packages/git/src/pack/writer.js';
import { concatBytes } from '../packages/git/src/protocol/bytes.js';

const falsyValues = [undefined, null, 0, false, '', NaN, 0n];

test('every falsy observer throw produces an incomplete benchmark and preserves the exact cause', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-falsy-benchmark-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const value of falsyValues) {
    await assert.rejects(runLargeRepositoryBenchmark({
      directory, files: 1, binaryBytes: 0, history: 1, samples: 1,
      onProgress() { throw value; }
    }), error => {
      assert.equal(error.name, 'BenchmarkFailure');
      assert.equal(error.cause, value);
      assert.equal(error.report.ok, false);
      assert.equal(error.report.complete, false);
      assert.equal(error.report.failure.phase, 'generate');
      assert.equal(error.report.fixture, null);
      assert.equal(error.report.storage, null);
      assert.deepEqual(error.report.measurements, {});
      return true;
    });
    assert.deepEqual(await readdir(directory), []);
  }
});

test('ordinary benchmark errors retain their exact message, code and cause', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-error-benchmark-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const primary = new GitError('Network', 'Observer failed');
  await assert.rejects(runLargeRepositoryBenchmark({
    directory, files: 1, binaryBytes: 0, history: 1, samples: 1,
    onProgress() { throw primary; }
  }), error => {
    assert.equal(error.cause, primary);
    assert.equal(error.message, primary.message);
    assert.equal(error.code, primary.code);
    assert.equal(error.report.ok, false);
    return true;
  });
});

test('a falsy pack failure remains the primary cause when response cancellation also fails', async () => {
  const { pack } = await writePack([{ type: 'blob', data: Uint8Array.of(65) }]);
  for (const value of falsyValues) {
    const cleanup = new GitError('Quota', 'Response cleanup failed');
    let cancellations = 0;
    const source = new ReadableStream({
      start(controller) { controller.enqueue(concatBytes([pack, new Uint8Array(128)])); },
      cancel() {
        cancellations++;
        throw cleanup;
      }
    });
    await assert.rejects(readPack(source, { onProgress() { throw value; } }), error => {
      assert.equal(error.code, 'Corrupt');
      assert.equal(error.cause, value);
      assert.deepEqual(error.errors, [value, cleanup]);
      assert.deepEqual(error.details.cleanupErrors, [{ code: 'Quota', message: cleanup.message }]);
      return true;
    });
    assert.equal(cancellations, 1);
    assert.equal(source.locked, false);
  }
});

test('successful pack cleanup leaves every original falsy rejection unchanged', async () => {
  const { pack } = await writePack([{ type: 'blob', data: Uint8Array.of(65) }]);
  for (const value of falsyValues) {
    let cancelled = false;
    const source = new ReadableStream({
      start(controller) { controller.enqueue(concatBytes([pack, new Uint8Array(128)])); },
      cancel() { cancelled = true; }
    });
    let caught = false;
    try { await readPack(source, { onProgress() { throw value; } }); }
    catch (error) {
      caught = true;
      assert.equal(error, value);
    }
    assert.equal(caught, true);
    assert.equal(cancelled, true);
    assert.equal(source.locked, false);
  }
});
