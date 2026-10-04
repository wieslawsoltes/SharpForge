import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWinuiExpectedFixture, validateWinuiExpectedResult } from '../../../scripts/conformance/oracle/winui-expected-fixtures.js';
import { mkdtemp, readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { adoptWinuiExpected, verifyWinuiExpected, validateWinuiCapture, main } from '../../../scripts/conformance/oracle/winui-expected.js';
import { envelope, expectedPath, verifyEntry, verifyStore } from '../../../scripts/conformance/oracle/store.js';
import { pin, root, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';

// Synthetic contract samples only: these are never adopted or claimed as native observations.
function sample(fixture) {
  const thickness = { left: 1, top: 2, right: 3, bottom: 4 };
  const element = () => ({
    path: '0', type: 'Microsoft.UI.Xaml.FrameworkElement', name: 'Synthetic',
    layoutSlot: { x: 1.25, y: 2.5, width: 30.75, height: 40 },
    desiredSize: { width: 30.75, height: 40 }, actualSize: { width: 30.75, height: 40 },
    properties: {
      width: { value: 'NaN', hasLocalValue: false }, height: { value: 40, hasLocalValue: true },
      minWidth: 0, maxWidth: 'Infinity', minHeight: 0, maxHeight: 'Infinity',
      margin: thickness, visibility: 'Visible', horizontalAlignment: 'Stretch', verticalAlignment: 'Stretch',
      flowDirection: 'LeftToRight', opacity: 1, isHitTestVisible: true, actualTheme: 'Light',
    }, children: [{ path: '0/0', type: 'Synthetic.NonFrameworkElement', children: [] }],
  });
  return {
    schemaVersion: 1, inputHash: fixture.inputHash, runtime: pin.runtime, culture: 'en-US', theme: 'Light', winuiAssemblyVersion: '3.1.2.0',
    observations: fixture.input.fixtures.map(item => item.expected === 'load-error' ? {
      id: item.id, status: 'load-error', exception: 'System.Runtime.InteropServices.COMException', hresult: -2147467259,
    } : {
      id: item.id, status: 'loaded', viewport: item.viewport, rasterizationScale: 1.25, layout: element(),
      automation: [{ type: 'Synthetic.AutomationPeer', className: '', controlType: 'Custom', name: '', automationId: '',
        isEnabled: true, isContentElement: false, isControlElement: true, children: [] }],
    }),
  };
}

function rejectsMutation(fixture, mutate) {
  const result = sample(fixture); mutate(result);
  assert.throws(() => validateWinuiExpectedResult(fixture, result));
}

test('one WinUI expected fixture binds the complete current native input and preserves raw values', async () => {
  const fixture = await loadWinuiExpectedFixture();
  assert.equal(fixture.id, 'winui-measurements'); assert.equal(fixture.oracleId, 'winui');
  assert.equal(fixture.langVersion, null); assert.equal(fixture.input.fixtures.length, 20);
  assert.equal(fixture.inputHash, fixture.input.inputHash);
  const result = sample(fixture), before = JSON.stringify(result);
  assert.equal(validateWinuiExpectedResult(fixture, result), result);
  assert.equal(JSON.stringify(result), before);
  assert.equal(result.observations[0].rasterizationScale, 1.25);
  assert.equal(result.observations[0].layout.properties.width.value, 'NaN');
  assert.equal(result.observations.at(-1).hresult, -2147467259);
});

test('WinUI expected dump rejects incomplete, reordered, stale and unsupported observations', async () => {
  const fixture = await loadWinuiExpectedFixture();
  for (const mutate of [
    result => result.observations.pop(),
    result => result.observations.reverse(),
    result => { result.observations[1].id = result.observations[0].id; },
    result => { result.inputHash = '0'.repeat(64); },
    result => { result.runtime = '0.0.0'; },
    result => { result.culture = 'fr-FR'; },
    result => { result.theme = 'Dark'; },
    result => { result.winuiAssemblyVersion = ''; },
    result => { result.observations[0].status = 'unsupported'; },
    result => { result.observations[0].viewport = { width: 1, height: 1 }; },
    result => { result.observations[0].rasterizationScale = 0; },
    result => { result.extra = true; },
  ]) rejectsMutation(fixture, mutate);
});

test('WinUI expected dump rejects missing native fields, malformed numbers and unsigned HRESULTs', async () => {
  const fixture = await loadWinuiExpectedFixture();
  for (const mutate of [
    result => { delete result.observations[0].layout.actualSize; },
    result => { delete result.observations[0].layout.properties.width.hasLocalValue; },
    result => { result.observations[0].layout.properties.width.value = null; },
    result => { result.observations[0].layout.properties.opacity = '1'; },
    result => { result.observations[0].layout.properties.opacity = Infinity; },
    result => { result.observations[0].layout.properties.extra = 1; },
    result => { result.observations[0].layout.properties.isEnabled = { value: true, hasLocalValue: false }; },
    result => { delete result.observations[0].automation[0].isEnabled; },
    result => { result.observations.at(-1).hresult = 2147483648; },
    result => { result.observations.at(-1).hresult = -2147483649; },
    result => { result.observations.at(-1).exception = ''; },
  ]) rejectsMutation(fixture, mutate);
});

test('WinUI expected trees enforce native traversal bounds and retain empty native peer roots', async () => {
  const fixture = await loadWinuiExpectedFixture();
  for (const mutate of [
    result => { result.observations[0].layout.children[0].path = '0/2'; },
    result => { result.observations[0].layout.children = Array.from({ length: 2048 }, (_, index) => ({ path: '0/' + index, type: 'Synthetic', children: [] })); },
    result => { result.observations[0].automation = Array(2049).fill(result.observations[0].automation[0]); },
    result => {
      let parent = result.observations[0].layout;
      for (let depth = 1; depth <= 65; depth++) {
        const child = { path: parent.path + '/0', type: 'Synthetic', children: [] };
        parent.children = [child]; parent = child;
      }
    },
    result => {
      let parent = result.observations[0].automation[0];
      for (let depth = 1; depth <= 65; depth++) { const child = { ...parent, children: [] }; parent.children = [child]; parent = child; }
    },
  ]) rejectsMutation(fixture, mutate);
  const result = sample(fixture); result.observations[0].automation = [];
  assert.equal(validateWinuiExpectedResult(fixture, result), result);
});

const reviewedCommit = 'a'.repeat(40);
function capture(fixture) {
  const result = sample(fixture), process = { exitCode: 0, signal: null, stdout: '', stderr: '', elapsedMs: 1 };
  return {
    schemaVersion: 1, status: 'captured-not-baseline-qualified', target: 'win32-x64', declaredFixtures: 20,
    commit: reviewedCommit, dirty: false, capturedAt: '2026-10-04T00:00:00.000Z',
    command: ['node', 'scripts/conformance/oracle/winui-measure/run.js', '--output', 'synthetic.json'],
    inputHash: fixture.inputHash, materials: structuredClone(fixture.input.materials), pinnedToolchain: structuredClone(pin),
    toolchain: { sdk: pin.sdk, runtime: pin.runtime, referencePack: pin.referencePack,
      roslyn: { version: pin.roslyn.version, sha256: pin.roslyn.platformHashes['win32-x64'] },
      referenceAssemblies: { count: pin.referenceAssemblies.count, sha256: pin.referenceAssemblies.sha256 },
      environment: { platform: 'win32-x64', osRelease: '10.0.26100', node: 'v24.21.0', imageOS: null, imageVersion: null,
        image: { kind: 'local', pinnedImage: false, reason: 'Synthetic fixture only; no native execution.' } } },
    commands: [
      { argv: ['dotnet', 'restore', '<temporary>\\WinUI\\Oracle.WinUI.csproj', '--locked-mode', '--configfile', '<temporary>\\NuGet.Config'], result: { ...process } },
      { argv: ['dotnet', 'build', '<temporary>\\WinUI\\Oracle.WinUI.csproj', '--no-restore', '-c', 'Release', '-o', '<temporary>\\out'], result: { ...process } },
    ],
    binaries: [{ name: 'Oracle.WinUI.exe', sha256: 'b'.repeat(64) }, { name: 'Oracle.WinUI.dll', sha256: 'c'.repeat(64) }],
    attempts: [1, 2, 3].map(number => ({ number, process: { ...process }, output: JSON.stringify(result), result: structuredClone(result),
      argv: ['<temporary>\\out\\Oracle.WinUI.exe', '<temporary>\\input.json', `<temporary>\\result-${number - 1}.json`] })),
    failures: [], unsupported: [],
  };
}
async function withDirectory(action) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-winui-expected-test-'));
  try { await action(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function optionsFor(directory, report) {
  const file = path.join(directory, 'synthetic-capture.json'), bytes = JSON.stringify(report);
  await writeFile(file, bytes);
  return { capture: file, reviewedCommit, reviewedSHA256: sha256(bytes), directory: path.join(directory, 'expected') };
}

test('reviewed WinUI capture adoption retains all values, verifies and never overwrites', async () => {
  await withDirectory(async directory => {
    const fixture = await loadWinuiExpectedFixture(), report = capture(fixture), options = await optionsFor(directory, report);
    const receipt = await adoptWinuiExpected(options);
    assert.equal(receipt.status, 'reviewed-capture-not-qualified'); assert.equal(receipt.attempts, 3);
    assert.equal(receipt.reviewedSHA256, options.reviewedSHA256);
    assert.deepEqual(receipt.toolchain.environment, report.toolchain.environment);
    assert.deepEqual(JSON.parse(await readFile(receipt.file, 'utf8')).result, report.attempts[0].result);
    assert.equal((await verifyWinuiExpected(options)).action, 'verified');
    await assert.rejects(adoptWinuiExpected(options), /EEXIST/);
    // A later stable capture at another DPI must not normalize into this baseline.
    for (const attempt of report.attempts) { attempt.result.observations[0].rasterizationScale = 1.5; attempt.output = JSON.stringify(attempt.result); }
    await assert.rejects(verifyWinuiExpected(await optionsFor(directory, report)), /mismatch/);
  });
});

test('WinUI adoption rejects incomplete attempts and identity/provenance drift before store writes', async () => {
  const fixture = await loadWinuiExpectedFixture();
  for (const mutate of [
    report => { report.attempts.pop(); },
    report => { report.attempts[2].number = 2; },
    report => { report.attempts[2].process.exitCode = 3221226107; },
    report => { report.attempts[2].process.signal = 'SIGTERM'; },
    report => { report.attempts[2].process.stderr = 'native failure'; },
    report => { report.attempts[2].result = null; },
    report => { report.attempts[2].output = '{}'; },
    report => { report.attempts[2].result.observations[0].rasterizationScale = 2; report.attempts[2].output = JSON.stringify(report.attempts[2].result); },
    report => { report.attempts[2].result.observations.pop(); report.attempts[2].output = JSON.stringify(report.attempts[2].result); },
    report => { report.status = 'unsupported'; },
    report => { report.failures.push('failed'); },
    report => { report.dirty = true; },
    report => { report.commit = 'd'.repeat(40); },
    report => { report.target = 'darwin-arm64'; },
    report => { report.materials[0].sha256 = '0'.repeat(64); },
    report => { report.inputHash = '0'.repeat(64); },
    report => { report.pinnedToolchain.windowsAppSDK = '0.0.0'; },
    report => { report.toolchain.roslyn.sha256 = '0'.repeat(64); },
    report => { report.toolchain.environment.platform = 'linux-x64'; },
    report => { report.toolchain.environment.image = { kind: 'github-hosted', pinnedImage: true, imageOS: 'wrong', imageVersion: 'wrong' }; },
    report => { report.commands[0].argv.splice(3, 1); },
    report => { report.commands[1].result.exitCode = 1; },
    report => { report.binaries.pop(); },
  ]) await withDirectory(async directory => {
    const report = capture(fixture); mutate(report);
    const options = await optionsFor(directory, report);
    await assert.rejects(adoptWinuiExpected(options));
    await assert.rejects(access(options.directory), /ENOENT/);
  });
  await withDirectory(async directory => {
    const options = await optionsFor(directory, capture(fixture));
    await assert.rejects(adoptWinuiExpected({ ...options, reviewedSHA256: '0'.repeat(64) }), /reviewed report/);
    await assert.rejects(access(options.directory), /ENOENT/);
  });
});

test('WinUI expected store retains legacy smoke records and separates measurement identities', async () => {
  await withDirectory(async directory => {
    const fixture = await loadWinuiExpectedFixture(), report = capture(fixture);
    const options = await optionsFor(directory, report);
    await adoptWinuiExpected(options);
    const legacy = JSON.parse(await readFile(path.join(root, 'tests/conformance/expected/winui', pin.windowsAppSDK, 'win32-x64', 'fcb1817ae928e2f371ec96d17151caa0f92f6b06ae23cd52dcb244371be8d0f1.json'), 'utf8'));
    const file = expectedPath(legacy, options.directory);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(legacy));
    assert.deepEqual(await verifyStore(options.directory), { entries: 2 });
    const entry = envelope('winui', fixture, report.attempts[0].result, 'win32-x64');
    assert.equal(await verifyEntry(entry, []), true);
    await assert.rejects(verifyEntry({ ...entry, oracleId: 'coreclr' }, [fixture]), /Wrong oracle/);
    await assert.rejects(verifyEntry({ ...entry, inputHash: '0'.repeat(64) }, [fixture]), /Stale input/);
    await assert.rejects(verifyEntry({ ...entry, result: legacy.result }, [fixture]), /Wrong result shape/);
    await assert.rejects(verifyEntry({ ...legacy, result: entry.result }, []), /Wrong result shape/);
  });
});

test('WinUI adoption CLI requires explicit reviewed inputs and rejects unknown/repeated options', async () => {
  for (const args of [[], ['adopt'], ['verify', '--capture', 'report.json'], ['adopt', '--unknown', 'x'],
    ['adopt', '--capture', 'a', '--capture', 'b'], ['adopt', '--capture']]) await assert.rejects(main(args));
  await assert.rejects(main(['adopt', '--capture', 'unused.json', '--reviewed-commit', reviewedCommit, '--reviewed-sha256', 'a'.repeat(64), 'constructor', 'x']), /Unknown, repeated or incomplete/);
  const fixture = await loadWinuiExpectedFixture();
  const report = capture(fixture), environment = report.toolchain.environment;
  environment.imageOS = pin.images.windows.imageOS; environment.imageVersion = pin.images.windows.imageVersion;
  environment.image = { kind: 'github-hosted', pinnedImage: true, imageOS: environment.imageOS, imageVersion: environment.imageVersion };
  assert.equal(validateWinuiCapture(report, fixture, reviewedCommit), report.attempts[0].result);
});
