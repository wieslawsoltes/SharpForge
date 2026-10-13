import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const probe = fileURLToPath(new URL('./clr-generics-closure-gc-fixture.js', import.meta.url));

test('CLR permanent definition authorities do not root abandoned collectible proof consumers', { timeout: 60000 }, async () => {
  const { stdout } = await execute(process.execPath, ['--expose-gc', probe], { timeout: 45000, maxBuffer: 1024 * 1024 });
  const report = JSON.parse(stdout);
  assert.equal(report.format, 'sharpforge.generic-closure-authority-gc');
  assert.equal(report.forcedGc, true);
  assert.equal(report.collected, 3);
  assert.ok(report.attempts <= report.maximumAttempts);
  assert.equal(report.capacityReclaimed, true);
  assert.equal(report.permanentDefinitionRetained, true);
});
