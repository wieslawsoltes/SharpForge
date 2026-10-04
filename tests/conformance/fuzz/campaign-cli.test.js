import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignArguments } from '../../../scripts/conformance/fuzz/run.js';

test('campaign CLI resolves only reviewed targets and bounded exact integer budgets', () => {
  const options = campaignArguments(['--target', 'protocol', '--seed', '4294967295', '--cases', '8', '--output', 'artifacts/fuzz/cli']);
  assert.deepEqual(options.selected, ['protocol']);
  assert.equal(options.seed, 0xffffffff);
  assert.equal(options.budgets.maxCases, 8);
  assert.equal(campaignArguments(['--output', 'artifacts/fuzz/all']).selected.length, 8);
  assert.deepEqual(campaignArguments(['--help']), { help: true });
});

test('campaign CLI rejects unknown execution targets, missing output and unbounded budgets before effects', () => {
  const invalid = [
    [], ['--target', '../child.js'], ['--target', 'harness-overrun'], ['--seed', '-1'], ['--seed', '4294967296'],
    ['--seed', '1e3'], ['--cases', '0'], ['--cases', '4097'], ['--case-ms', '2001'], ['--campaign-ms', '600001'],
    ['--replay', 'corpus', '--target', 'network'], ['--module', './custom.js'],
  ];
  assert.throws(() => campaignArguments([]), /output/);
  for (const args of invalid.slice(1)) assert.throws(() => campaignArguments([...args, '--output', 'artifacts/fuzz/invalid']));
});
