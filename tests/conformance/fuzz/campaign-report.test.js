import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { campaignStatus, campaignExitCode, writeCampaignReport } from '../../../scripts/conformance/fuzz/campaign-report.js';

const source = Object.freeze({ commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true });
const passed = [{ targetId: 'protocol', status: 'passed' }];

test('passing adapter evidence requires stable clean source and complete unique target membership', () => {
  assert.equal(campaignStatus(passed, ['protocol'], source, source), 'passed');
  assert.equal(campaignStatus([], ['protocol'], source, source), 'incomplete');
  assert.equal(campaignStatus([], [], source, source), 'incomplete');
  assert.equal(campaignStatus([...passed, ...passed], ['protocol', 'network'], source, source), 'incomplete');
  assert.equal(campaignStatus(passed, ['network'], source, source), 'incomplete');
  assert.equal(campaignStatus(passed, ['protocol'], { ...source, clean: false }, source), 'incomplete');
  assert.equal(campaignStatus(passed, ['protocol'], source, { ...source, commit: 'c'.repeat(40) }), 'incomplete');
  assert.equal(campaignStatus(passed, ['protocol'], { ...source, tree: null }, source), 'incomplete');
});

test('failed, cancelled, incomplete and unsupported reports retain distinct nonpassing exit status', () => {
  for (const status of ['failed', 'cancelled', 'incomplete', 'unsupported']) {
    assert.equal(campaignStatus([{ targetId: 'protocol', status }], ['protocol'], source, source), status);
    assert.notEqual(campaignExitCode(status), 0);
  }
  assert.equal(campaignStatus([{ targetId: 'protocol', status: 'unknown' }], ['protocol'], source, source), 'failed');
  assert.equal(campaignExitCode('passed'), 0);
  assert.equal(campaignExitCode('failed'), 1);
});

test('campaign evidence is byte-hashed and refuses overwrite and path traversal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-campaign-report-'));
  try {
    const report = { status: 'failed', original: 'preserve this failure' };
    const asset = await writeCampaignReport(directory, report);
    const bytes = await readFile(join(directory, asset.path));
    assert.equal(asset.bytes, bytes.length);
    assert.equal(asset.sha256, createHash('sha256').update(bytes).digest('hex'));
    await assert.rejects(writeCampaignReport(directory, { status: 'passed' }), { code: 'EEXIST' });
    assert.deepEqual(JSON.parse(await readFile(join(directory, asset.path), 'utf8')), report);
    await assert.rejects(writeCampaignReport(directory, report, '../escape.json'), /Invalid report filename/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
