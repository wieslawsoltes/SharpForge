import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadBclExpectedFixtures, validateBclExpectedResult } from '../../../scripts/conformance/oracle/bcl-expected-fixtures.js';
import { adoptBclCapture, verifyBclCapture, validateBclCapture } from '../../../scripts/conformance/oracle/bcl-expected.js';
import { envelope, expectedPath, verifyEntry, verifyStore, writeExpected } from '../../../scripts/conformance/oracle/store.js';
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

async function captureReceipt() {
  const fixtures = await loadBclExpectedFixtures();
  const target = pin.platforms.coreclr.find(value => value !== platform);
  const report = {
    schemaVersion: 1, status: 'captured-not-baseline-qualified', target,
    cultures: ['invariant', 'fr-FR'], declaredCases: 200, pinnedToolchain: structuredClone(pin),
    toolchain: { sdk: pin.sdk, runtime: pin.runtime, referencePack: pin.referencePack,
      roslyn: { version: pin.roslyn.version, sha256: pin.roslyn.platformHashes[target] },
      referenceAssemblies: { sha256: pin.referenceAssemblies.sha256, count: pin.referenceAssemblies.count },
      environment: { platform: target, osRelease: 'unit-only', node: process.version,
        image: { kind: 'local', pinnedImage: false }, imageOS: null, imageVersion: null } },
    families: [], unsupported: [], failures: [], commit: 'a'.repeat(40), dirty: false,
    capturedAt: '2026-10-04T00:00:00.000Z', command: ['node', 'bcl-run.js', '--output', 'unit-only.json'],
  };
  for (const fixture of fixtures) {
    let family = report.families.find(item => item.family === fixture.family);
    if (!family) {
      family = { family: fixture.family, inputHash: fixture.familyInputHash, sourceSHA256: fixture.sourceSHA256,
        catalogSHA256: fixture.catalogSHA256, compilation: {
          result: { exitCode: 0, diagnostics: [], assemblySHA256: '1'.repeat(64) },
          timings: [1, 2], command: ['dotnet', 'csc.dll'] }, captures: [] };
      report.families.push(family);
    }
    const result = processResult(fixture);
    result.stdout = result.stdout.replaceAll('\n', '\r\n');
    family.captures.push({ culture: fixture.culture, inputHash: fixture.inputHash, result,
      timings: [1, 2], command: ['dotnet', '<temporary>/Oracle.dll'],
      observations: validateBclExpectedResult(fixture, result) });
  }
  return report;
}

test('BCL adoption preserves target/raw output, compares all ten keys, and is idempotent', async () => {
  const report = await captureReceipt(), store = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-bcl-adopt-'));
  try {
    const result = await adoptBclCapture(report, { store });
    assert.equal(result.status, 'adopted-not-qualified');
    assert.equal(result.target, report.target);
    assert.equal(result.observations, 400);
    assert.equal(result.written, 10);
    assert.equal((await adoptBclCapture(report, { store })).written, 0);
    assert.equal((await verifyBclCapture(report, { store })).entries, 10);
    const { entries } = await validateBclCapture(report);
    const stored = JSON.parse(await readFile(expectedPath(entries[0], store), 'utf8'));
    assert.equal(stored.target, report.target);
    assert.ok(stored.result.stdout.includes('\r\n'));
    assert.deepEqual(stored.result, entries[0].result);
    await rm(expectedPath(entries.at(-1), store));
    await assert.rejects(verifyBclCapture(report, { store }), /Missing or invalid expected/);
  } finally { await rm(store, { recursive: true, force: true }); }
});

test('BCL adoption rejects incomplete or stale capture metadata before writing any family', async () => {
  const original = await captureReceipt(), store = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-bcl-reject-'));
  const changes = [
    report => { report.dirty = true; },
    report => { report.status = 'failed'; },
    report => { report.failures.push('native failure'); },
    report => { report.unsupported.push({ target: 'unit-only' }); },
    report => { report.declaredCases = 199; },
    report => { report.cultures.reverse(); },
    report => { report.families.pop(); },
    report => { report.families[4] = structuredClone(report.families[0]); },
    report => { report.families[4].sourceSHA256 = '0'.repeat(64); },
    report => { report.families[4].catalogSHA256 = '0'.repeat(64); },
    report => { report.families[4].inputHash = '0'.repeat(64); },
    report => { report.families[4].captures.pop(); },
    report => { report.families[4].captures[1] = structuredClone(report.families[4].captures[0]); },
    report => { report.families[4].captures[1].inputHash = '0'.repeat(64); },
    report => { report.families[4].captures[1].observations[0].value = 'tampered'; },
    report => { report.families[4].captures[1].result.stderr = 'native failure'; },
    report => { report.families[4].captures[1].timings.pop(); },
    report => { report.families[4].compilation.result.assemblySHA256 = null; },
    report => { report.families[4].compilation.timings = [1, -1]; },
    report => { report.target = 'linux-arm64'; },
    report => { report.toolchain.environment.platform = 'unit-only'; },
    report => { report.toolchain.environment.image = { kind: 'test', pinnedImage: false }; },
    report => { report.toolchain.roslyn.sha256 = '0'.repeat(64); },
    report => { report.toolchain.referenceAssemblies.count--; },
    report => { report.pinnedToolchain.sdk = 'unit-only'; },
  ];
  try {
    for (const change of changes) {
      const report = structuredClone(original); change(report);
      await assert.rejects(adoptBclCapture(report, { store }));
      assert.deepEqual(await readdir(store), [], 'No early family writes before full preflight');
    }
  } finally { await rm(store, { recursive: true, force: true }); }
});

test('BCL adoption never overwrites a conflicting key, even when earlier keys are absent', async () => {
  const report = await captureReceipt(), store = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-bcl-conflict-'));
  try {
    const { entries } = await validateBclCapture(report), last = structuredClone(entries.at(-1));
    const rows = last.result.stdout.trimEnd().split('\r\n');
    const first = JSON.parse(rows[0]); first.value = 'different-native-value';
    last.result.stdout = [JSON.stringify(first), ...rows.slice(1)].join('\r\n') + '\r\n';
    const file = await writeExpected(last, store), before = await readFile(file, 'utf8');
    await assert.rejects(adoptBclCapture(report, { store }), /Conflicting BCL expected/);
    assert.equal(await readFile(file, 'utf8'), before);
    await assert.rejects(readFile(expectedPath(entries[0], store)), { code: 'ENOENT' });
    await writeFile(file, 'null');
    await assert.rejects(adoptBclCapture(report, { store }), /Conflicting BCL expected/);
    await assert.rejects(readFile(expectedPath(entries[0], store)), { code: 'ENOENT' });
    await writeFile(file, JSON.stringify(entries.at(-1)));
    await adoptBclCapture(report, { store });
    await writeFile(file, before);
    await assert.rejects(verifyBclCapture(report, { store }), /expected output mismatch/);
  } finally { await rm(store, { recursive: true, force: true }); }
});
