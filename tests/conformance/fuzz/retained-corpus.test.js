import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readCorpus } from '../../../scripts/conformance/fuzz/corpus.js';
import { replayCorpus } from '../../../scripts/conformance/fuzz/harness.js';

const directory = fileURLToPath(new URL('../fuzz-corpus/', import.meta.url));

test('every reviewed retained input is replayed by the normal A29 Node manifest', async context => {
  const records = await readCorpus({ directory });
  if (!records.length) {
    context.skip('No reviewed production crash inputs have been promoted; this is not target qualification.');
    return;
  }
  const result = await replayCorpus({ directory, budgets: { maxCases: 128, campaignTimeoutMs: 600000 } });
  assert.equal(result.completedCases, records.length, JSON.stringify(result));
  assert.equal(result.status, 'passed', JSON.stringify(result));
});
