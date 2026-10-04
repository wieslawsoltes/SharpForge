import test from 'node:test';
import assert from 'node:assert/strict';
import { gitAvailability } from './git-conformance/native.js';
import { ConformanceReport } from './git-conformance/report.js';
import { runShallowConformance } from './git-conformance/shallow.js';

test('native shallow clone, relative/absolute depth, shortening and unshallow agree in both object formats',
  { timeout: 180_000 }, async context => {
    const availability = await gitAvailability();
    if (!availability.available) { context.skip(availability.reason); return; }
    const report = new ConformanceReport(availability.version);
    for (const algorithm of ['sha1', 'sha256']) {
      try { await runShallowConformance(report, algorithm); }
      catch (error) { report.failure(`shallow-${algorithm}`, error); }
    }
    const result = report.summary();
    context.diagnostic(`SHARPFORGE_GIT_SHALLOW ${JSON.stringify(result)}`);
    assert.equal(result.failed, 0, JSON.stringify(result.failures, null, 2));
    assert.equal(result.families['shallow-history'].passed, 10);
    assert.equal(result.families['shallow-api-history'].passed, 10);
    assert.equal(result.families['shallow-revision'].passed, 20);
    assert.equal(result.families['shallow-full-clone'].passed, 2);
    assert.equal(result.families['shallow-fetch'].passed, 8);
    assert.equal(result.families['shallow-fsck'].passed, 20);
  });
