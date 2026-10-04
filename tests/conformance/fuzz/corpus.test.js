import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputDigest, readCorpus, writeFinding } from '../../../scripts/conformance/fuzz/corpus.js';
import { replayCorpus } from '../../../scripts/conformance/fuzz/harness.js';

// Synthetic store records exercise tooling integrity; they are not measured product findings.
function observation(input) {
  return {
    targetId: 'pe-loader', seed: 7, caseIndex: 2, status: 'finding', qualification: 'node-offline-parser',
    inputSHA256: inputDigest(input), inputBytes: input.length, sourceIdentity: null,
    finding: { kind: 'tooling-fixture', detail: 'Synthetic store test record, not product qualification' },
  };
}

async function temporary(action) {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-fuzz-corpus-'));
  try { return await action(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('corpus deduplicates exact records and retains original limits and literal bytes', async () => temporary(async directory => {
  const input = Uint8Array.of(0, 255, 19);
  const record = observation(input);
  const path = await writeFinding(directory, record, input, { budgets: { caseTimeoutMs: 30 } });
  assert.equal(await writeFinding(directory, record, input, { budgets: { caseTimeoutMs: 30 } }), path);
  const stored = await readCorpus({ directory });
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].input, input);
  assert.equal(stored[0].budgets.caseTimeoutMs, 30);
  assert.equal(stored[0].sourceIdentity, null);
}));

test('finding attribution cannot be switched to another input or source revision', async () => temporary(async directory => {
  const input = Uint8Array.of(1);
  await assert.rejects(writeFinding(directory, observation(input), Uint8Array.of(2)), /input identity/);
  const sourceIdentity = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true };
  await assert.rejects(writeFinding(directory, observation(input), input, { sourceIdentity }), /source identity/);
}));

test('finding persistence retains observed budgets and rejects explicit widening or narrowing', async () => temporary(async directory => {
  const input = Uint8Array.of(1);
  const record = { ...observation(input), budgets: { caseTimeoutMs: 30, heapGrowthBytes: 65536 } };
  const path = await writeFinding(directory, record, input);
  const stored = await readCorpus({ directory });
  assert.equal(stored[0].budgets.caseTimeoutMs, 30);
  assert.equal(stored[0].budgets.heapGrowthBytes, 65536);
  assert.equal(await writeFinding(directory, record, input, { budgets: record.budgets }), path);
  for (const caseTimeoutMs of [25, 1000]) {
    await assert.rejects(writeFinding(directory, record, input,
      { budgets: { caseTimeoutMs, heapGrowthBytes: 65536 } }), /budget identity/);
  }
  await assert.rejects(writeFinding(directory, record, input, { budgets: {} }), /budget identity/);
  assert.equal((await readCorpus({ directory })).length, 1);
}));

test('corrupted record content and unexpected filenames fail before parser replay', async () => temporary(async directory => {
  const input = Uint8Array.of(1);
  const path = await writeFinding(directory, observation(input), input);
  const data = JSON.parse(await readFile(path, 'utf8'));
  data.seed++;
  await writeFile(path, JSON.stringify(data));
  const report = await replayCorpus({ directory });
  assert.equal(report.status, 'failed');
  assert.equal(report.completedCases, 0);
  assert.match(report.error, /checksum/);
  await rename(path, join(directory, 'arbitrary.json'));
  await assert.rejects(readCorpus({ directory }), /filename/);
}));

test('recomputed record checksums cannot bless a different input digest or findings as expected outcomes', async () => {
  for (const change of [record => { record.inputBase64 = 'Ag=='; }, record => { record.expectedStatuses = ['finding']; }]) {
    await temporary(async directory => {
      const input = Uint8Array.of(1);
      const path = await writeFinding(directory, observation(input), input);
      const record = JSON.parse(await readFile(path, 'utf8'));
      delete record.recordSHA256;
      change(record);
      record.recordSHA256 = inputDigest(JSON.stringify(record));
      const changed = join(directory, `${record.recordSHA256}.json`);
      await rename(path, changed);
      await writeFile(changed, JSON.stringify(record));
      await assert.rejects(readCorpus({ directory }), /checksum|cannot allow/);
    });
  }
});

test('concurrent writers cannot exceed a one-record corpus quota', async () => temporary(async directory => {
  const inputs = [Uint8Array.of(1), Uint8Array.of(2)];
  const outcomes = await Promise.allSettled(inputs.map(input => writeFinding(directory, observation(input), input,
    { budgets: { maxCorpusCases: 1 } })));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await readCorpus({ directory })).length, 1);
}));

test('empty corpus is incomplete and ignored entries cannot evade the directory scan budget', async () => temporary(async directory => {
  const empty = await replayCorpus({ directory });
  assert.equal(empty.status, 'incomplete');
  assert.equal(empty.completedCases, 0);
  for (let index = 0; index < 20; index++) await writeFile(join(directory, `note-${index}.txt`), '');
  await assert.rejects(readCorpus({ directory, budgets: { maxCorpusCases: 1 } }), /directory entry limit/);
}));

test('corpus symlinks are rejected rather than followed', async context => {
  if (process.platform === 'win32') { context.skip('Creating test symlinks requires separately qualified Windows privileges'); return; }
  await temporary(async directory => {
    await writeFile(join(directory, 'owned.txt'), 'owned');
    await symlink(join(directory, 'owned.txt'), join(directory, `${'a'.repeat(64)}.json`));
    await assert.rejects(readCorpus({ directory }), /symlinks/);
  });
});
