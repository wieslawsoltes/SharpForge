import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyHostedReference} from '../scripts/a05/hosted-reference-check.js';

test('the hosted reference launcher retains a real worker failure for an invalid manifest', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a05-reference-worker-'));
  const product = fileURLToPath(new URL('../', import.meta.url));
  const manifest = '{"format":"invalid","status":"created"}\n';
  writeFileSync(join(directory, 'profiler-reference.json'), manifest);
  try {
    const result = await verifyHostedReference({directory, product});
    assert.equal(result.process.exitCode, 1);
    assert.equal(result.process.signal, null);
    assert.equal(result.process.cancelled, false);
    assert.equal(result.report.format, 'SharpForge.HostedProfilerReferenceValidation/1');
    assert.equal(result.report.status, 'failed');
    assert.match(result.report.error.message, /Profiler reference does not match the clean product revision/);
    assert(result.command.includes('scripts/a05/hosted-reference-worker.js'));
    assert(result.report.command.some(argument => argument.endsWith('hosted-reference-worker.js')));
    assert.equal(result.report.sourceCommit, undefined);
    assert(Number.isFinite(Date.parse(result.report.startedAt)));
    assert(Number.isFinite(Date.parse(result.report.completedAt)));
    assert.match(readFileSync(join(directory, 'profiler-reference-after-off.log'), 'utf8'), /failed/);
    assert.equal(readFileSync(join(directory, 'profiler-reference.json'), 'utf8'), manifest);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
