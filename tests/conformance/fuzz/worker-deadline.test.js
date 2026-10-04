import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBudgets } from '../../../scripts/conformance/fuzz/budgets.js';
import { runCampaign, runCase } from '../../../scripts/conformance/fuzz/harness.js';
import { classifyCompletion } from '../../../scripts/conformance/fuzz/worker.js';

const budgets = normalizeBudgets({ caseTimeoutMs: 25 });
const metrics = elapsedMs => ({ elapsedMs, observedGrowthBytes: 0 });
const outcomes = [
  { status: 'accepted' },
  { status: 'rejected', code: 'FUZZ_CANCELLED' },
  { status: 'unsupported', code: 'FIXTURE_UNSUPPORTED' },
];

test('worker completion rejects swallowed local cancellation independently of the parent watchdog', () => {
  for (const outcome of outcomes) {
    const result = classifyCompletion(outcome, 'run', budgets, metrics(25), true);
    assert.equal(result.status, 'finding');
    assert.equal(result.finding.kind, 'case-timeout');
    assert.equal(result.code, undefined);
  }
});

test('measured synchronous overrun wins even when the local abort callback could not run', () => {
  for (const outcome of outcomes) {
    const result = classifyCompletion(outcome, 'run', budgets, metrics(25.01), false);
    assert.equal(result.status, 'finding');
    assert.equal(result.finding.kind, 'case-timeout');
  }
  const memoryAndTime = { elapsedMs: 26, observedGrowthBytes: budgets.heapGrowthBytes + 1 };
  assert.equal(classifyCompletion(outcomes[0], 'run', budgets, memoryAndTime, false).finding.kind, 'case-timeout');
});

test('seed collection observes the same deadline and ordinary bounded outcomes remain unchanged', () => {
  const seeds = { status: 'accepted', seeds: [{ name: 'owned', inputBase64: 'AA==' }] };
  for (const [elapsedMs, aborted] of [[25.01, false], [25, true]]) {
    const result = classifyCompletion(seeds, 'seeds', budgets, metrics(elapsedMs), aborted);
    assert.equal(result.status, 'finding');
    assert.equal(result.finding.kind, 'case-timeout');
    assert.equal(result.seeds, undefined);
  }
  for (const outcome of [...outcomes, seeds]) {
    const measured = metrics(25);
    const mode = outcome.seeds ? 'seeds' : 'run';
    assert.deepEqual(classifyCompletion(outcome, mode, budgets, measured, false), { ...outcome, metrics: measured });
  }
});

test('the fixed finite cancellation-rejection fixture remains a finding through process isolation', async () => {
  const result = await runCase({
    targetId: 'harness-abort-rejection', input: Uint8Array.of(1), selfTest: true, budgets,
  });
  assert.equal(result.status, 'finding');
  assert.equal(result.finding.kind, 'case-timeout');
  assert.equal(result.qualification, 'harness-self-check');
  await assert.rejects(runCampaign({ targetId: 'harness-abort-rejection' }), /fixed reviewed/);
});
