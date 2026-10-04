import test from 'node:test';
import assert from 'node:assert/strict';
import { runConformance } from './git-conformance/run.js';

test('A25 native Git command families match objects, refs, index, worktree and integrity', { timeout: 240_000 }, async context => {
  const result = await runConformance({ emit: text => context.diagnostic(text) });
  if (result.skipped) { context.skip(result.reason); return; }
  assert.equal(result.failed, 0, JSON.stringify(result.failures, null, 2));
  assert.ok(result.families['rev-parse'].passed >= 120, 'At least sixty revision expressions per object format');
  assert.ok(result.families.blame.passed >= 60, 'At least thirty file histories per object format');
  assert.equal(result.families['object-format'].passed, 2, 'Both formats complete actual HTTP clone and native format inspection');
  assert.ok(result.families.push.passed >= 4, 'Both formats commit and push through native receive-pack');
  for (const family of ['clone', 'status', 'add', 'commit', 'log', 'diff', 'push', 'proxy', 'fsck']) {
    assert.ok(result.families[family].passed > 0, `${family} command family was exercised`);
  }
});
