import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCampaign, runCase } from '../../../scripts/conformance/fuzz/harness.js';
import { writeFinding } from '../../../scripts/conformance/fuzz/corpus.js';
import { runIsolated } from '../../../scripts/conformance/fuzz/process.js';

const input = Uint8Array.of(0, 1, 2, 255);
const selfCase = (targetId, options = {}) => runCase({ targetId, input, selfTest: true, ...options });

test('fixed self-checks distinguish acceptance, controlled rejection and unexpected exceptions', async () => {
  const accepted = await selfCase('harness-accepted');
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.qualification, 'harness-self-check');
  assert.equal(accepted.isolation.osMemorySandbox, false);
  assert.equal(accepted.isolation.v8OldSpaceMb, 128);
  assert.equal((await selfCase('harness-rejected')).status, 'rejected');
  const failure = await selfCase('harness-failure');
  assert.equal(failure.status, 'finding');
  assert.equal(failure.finding.kind, 'unexpected-error');
});

test('finite deadline and 4 MiB allocation probes are detected and saved with their exact input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-fuzz-evidence-'));
  try {
    const probes = [
      ['harness-overrun', { caseTimeoutMs: 25 }, 'case-timeout'],
      ['harness-allocation', { heapGrowthBytes: 65536 }, 'memory-growth'],
    ];
    for (const [targetId, budgets, kind] of probes) {
      const result = await selfCase(targetId, { budgets });
      assert.equal(result.status, 'finding');
      assert.equal(result.finding.kind, kind);
      const path = await writeFinding(directory, result, input);
      const record = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(record.inputSHA256, result.inputSHA256);
      assert.deepEqual(record.budgets, result.budgets);
      assert.deepEqual(new Uint8Array(Buffer.from(record.inputBase64, 'base64')), input);
      assert.equal(record.selfTest, true);
      assert.deepEqual(record.expectedStatuses, ['accepted', 'rejected']);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('output overflow and an undisposed finite timer remain findings', async () => {
  const output = await selfCase('harness-output', { budgets: { maxOutputBytes: 1024 } });
  assert.equal(output.status, 'finding');
  assert.equal(output.finding.kind, 'output-limit');
  const disposal = await selfCase('harness-disposal', { budgets: { caseTimeoutMs: 25 } });
  assert.equal(disposal.status, 'finding');
  assert.equal(disposal.finding.kind, 'case-timeout');
});

test('pre-launch and active cancellation remain cancellation rather than acceptance', async () => {
  const before = new AbortController();
  before.abort();
  const cancelled = await selfCase('harness-accepted', { signal: before.signal });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.metrics.processElapsedMs, 0);
  const active = new AbortController();
  const timer = setTimeout(() => active.abort(), 50);
  try { assert.equal((await selfCase('harness-overrun', { signal: active.signal })).status, 'cancelled'); }
  finally { clearTimeout(timer); }
});

test('ambient Node options cannot inject arguments into the fixed child', async () => {
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--sharpforge-owned-invalid-option';
  try { assert.equal((await selfCase('harness-accepted')).status, 'accepted'); }
  finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
});

test('normal campaigns cannot select self-checks, arbitrary modules, or bypass low-level caps', async () => {
  await assert.rejects(runCampaign({ targetId: 'harness-allocation' }), /fixed reviewed/);
  await assert.rejects(runCase({ targetId: './owned-or-unowned.js', input }), /fixed reviewed/);
  await assert.rejects(runCase({ targetId: 'pe-loader', input: new Uint8Array(65537) }), /byte limit/);
  await assert.rejects(runIsolated({ targetId: 'harness-accepted', selfTest: true, mode: 'run', inputBase64: '',
    budgets: { v8HeapMb: 1024 } }), /v8HeapMb/);
});
