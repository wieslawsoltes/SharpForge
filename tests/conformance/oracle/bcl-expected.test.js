import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadBclExpectedFixtures } from '../../../scripts/conformance/oracle/bcl-expected-fixtures.js';
import { envelope, verifyEntry, verifyStore, writeExpected } from '../../../scripts/conformance/oracle/store.js';
import { pin, platform } from '../../../scripts/conformance/oracle/toolchain.js';

// Synthetic process records test ingestion only. These are never native baselines.
function processResult(fixture) {
  return {
    stdout: fixture.cases.map(item => JSON.stringify({
      id: item.id, family: fixture.family, culture: fixture.culture,
      status: item.exception ? 'exception' : 'returned',
      value: item.exception ? null : `unit-only:${item.id}`, exception: item.exception,
    })).join('\n') + '\n',
    stderr: '', exitCode: 0, signal: null, unhandledException: null,
  };
}

test('BCL store resolves all family/culture inputs and retains the observation target', async () => {
  const fixtures = await loadBclExpectedFixtures();
  assert.equal(fixtures.length, 10);
  assert.equal(new Set(fixtures.map(fixture => fixture.id)).size, 10);
  assert.equal(new Set(fixtures.map(fixture => fixture.inputHash)).size, 10);
  assert.equal(fixtures.reduce((count, fixture) => count + fixture.cases.length, 0), 400);
  const target = pin.platforms.coreclr.find(value => value !== platform);
  assert.ok(target, 'Fixture exercises adoption from another native target');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-bcl-store-'));
  try {
    for (const fixture of fixtures) {
      const entry = envelope('coreclr', fixture, processResult(fixture), target);
      assert.equal(entry.target, target);
      await verifyEntry(entry, fixtures);
      await writeExpected(entry, directory);
    }
    assert.deepEqual(await verifyStore(directory), { entries: 10 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('BCL store rejects stale input, wrong oracle, culture drift and incomplete observations', async () => {
  const fixtures = await loadBclExpectedFixtures(), fixture = fixtures[0];
  const entry = envelope('coreclr', fixture, processResult(fixture), pin.platforms.coreclr[0]);
  await assert.rejects(verifyEntry({ ...entry, inputHash: '0'.repeat(64) }, fixtures), /Stale input hash/);
  await assert.rejects(verifyEntry(envelope('roslyn', fixture,
    { exitCode: 0, diagnostics: [], assemblySHA256: '1'.repeat(64) }, entry.target), fixtures), /Wrong oracle/);
  const rows = entry.result.stdout.trimEnd().split('\n');
  const changed = JSON.parse(rows[0]); changed.culture = 'unregistered-culture';
  await assert.rejects(verifyEntry({ ...entry, result: { ...entry.result,
    stdout: [JSON.stringify(changed), ...rows.slice(1)].join('\n') + '\n' } }, fixtures), /BCL result contract/);
  await assert.rejects(verifyEntry({ ...entry, result: { ...entry.result,
    stdout: rows.slice(1).join('\n') + '\n' } }, fixtures), /Incomplete or extra/);
  await assert.rejects(verifyEntry({ ...entry, result: { ...entry.result,
    stdout: [...rows, rows[0]].join('\n') + '\n' } }, fixtures), /Incomplete or extra/);
  await assert.rejects(verifyEntry({ ...entry, result: { ...entry.result, stderr: 'native failure' } }, fixtures), /native process failed/);
});
