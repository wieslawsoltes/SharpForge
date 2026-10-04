import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { campaignArguments } from '../../../scripts/conformance/fuzz/run.js';
import { reproductionCommands } from '../../../scripts/conformance/fuzz/reproduction.js';

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

test('reproduction argv retains seed, effective CLI budgets, reviewed target and literal paths', () => {
  const options = campaignArguments(['--target', 'portable-pdb', '--seed', '17', '--cases', '81',
    '--case-ms', '120', '--campaign-ms', '4000', '--output', 'artifacts/fuzz/path with spaces']);
  const commands = reproductionCommands(options, resolve('.'), [{ targetId: 'portable-pdb', artifacts: ['finding.json'] }]);
  const campaign = campaignArguments(commands.campaign.slice(4));
  assert.equal(campaign.seed, options.seed);
  assert.deepEqual(campaign.selected, options.selected);
  assert.deepEqual(campaign.budgets, options.budgets);
  assert.notEqual(campaign.output, options.output);
  const replay = campaignArguments(commands.findings[0].argv.slice(4));
  assert.equal(replay.replay, resolve(options.output, 'portable-pdb', 'findings'));
  assert.deepEqual(replay.budgets, options.budgets);
  const repeat = reproductionCommands(replay, resolve('.'), []);
  assert.equal(campaignArguments(repeat.campaign.slice(4)).replay, replay.replay);
  assert.deepEqual(repeat.findings, []);
});
