import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createProcessRecorder } from './fixtures/a03-method-headers/process-capture.mjs';

test('header capture preserves the admitted command and partial native output when the canonical runner rejects', async () => {
  const output = await mkdtemp(join(tmpdir(), 'sharpforge-header-recorder-'));
  try {
    const commands = [];
    const reportPath = join(output, 'capture.json');
    const result = { stdout: 'partial stdout\n', stderr: 'partial stderr\n', exitCode: null, signal: 'SIGTERM', elapsedMs: 2 };
    const failure = Object.assign(new Error('Oracle process timed out'), { result });
    const save = () => writeFile(reportPath, JSON.stringify({ commands }) + '\n');
    const record = createProcessRecorder({ output, commands, save, processRunner: async (executable, args, options) => {
      assert.equal(executable, '/recorded/dotnet');
      assert.deepEqual(args, ['--version']);
      assert.deepEqual(options, { cwd: output, timeoutMs: 31, maxOutputBytes: 127 });
      const admitted = JSON.parse(await readFile(reportPath, 'utf8')).commands;
      assert.equal(admitted.length, 1);
      assert.equal(admitted[0].status, 'running');
      throw failure;
    } });
    await assert.rejects(record('/recorded/dotnet', ['--version'], { cwd: output, timeoutMs: 31, maxOutputBytes: 127 }),
      error => error === failure && error.result === result);
    const command = JSON.parse(await readFile(reportPath, 'utf8')).commands[0];
    assert.equal(command.status, 'failed');
    assert.equal(command.error.message, failure.message);
    for (const key of ['stdout', 'stderr', 'exitCode', 'signal', 'elapsedMs']) assert.deepEqual(command[key], result[key]);
    for (const stream of ['stdout', 'stderr']) {
      const bytes = await readFile(join(output, command.logs[stream].path));
      assert.equal(bytes.toString('utf8'), result[stream]);
      assert.equal(command.logs[stream].bytes, bytes.length);
      assert.equal(command.logs[stream].sha256, createHash('sha256').update(bytes).digest('hex'));
    }
    assert.ok(Number.isFinite(Date.parse(command.startedAt)) && Number.isFinite(Date.parse(command.finishedAt)));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
