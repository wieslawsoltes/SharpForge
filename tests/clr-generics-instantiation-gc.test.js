import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const probe = fileURLToPath(new URL('./clr-generics-instantiation-gc-fixture.js', import.meta.url));

test('CLR canonical generic caches release collectible definitions and arguments through every supported wrapper', { timeout: 60000 }, async () => {
  const { stdout } = await execute(process.execPath, ['--expose-gc', probe], { timeout: 45000, maxBuffer: 1024 * 1024 });
  const report = JSON.parse(stdout);
  assert.equal(report.format, 'sharpforge.generic-instantiation-gc');
  assert.equal(report.version, 1);
  assert.equal(report.forcedGc, true);
  assert.equal(report.cases.length, 10);
  assert.equal(report.sharedDefinitionRetained, true);
  assert.equal(report.ordinaryIdentityRetained, true);
  for (const result of report.cases) {
    assert.equal(result.retained, true, result.kind);
    assert.ok(result.attempts <= report.maximumAttempts, result.kind);
    assert.ok(result.collected.every(entry => entry.collected), result.kind);
  }
});
