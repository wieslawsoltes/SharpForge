import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pin, oracleRoot, root, assertPins, assertImage, requireTarget, resolveToolchain } from '../../../scripts/conformance/oracle/toolchain.js';
import { loadFixture, loadFixtures } from '../../../scripts/conformance/oracle/fixtures.js';
import { compileFixture, assertDeterministic } from '../../../scripts/conformance/oracle/roslyn-compile.js';
import { runFixture, executeAssembly } from '../../../scripts/conformance/oracle/clr-run.js';
import { envelope, validateSchema, verifyEntry, expectedPath, writeExpected, compareExpected, verifyStore } from '../../../scripts/conformance/oracle/store.js';
import { parseArguments, checkFixtureContract, planTargets } from '../../../scripts/conformance/oracle/qualify.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';

const definition = { id: 'hello-unicode', source: 'Hello.cs', langVersion: '12.0' };
const syntheticResult = { exitCode: 0, diagnostics: [], assemblySHA256: 'a'.repeat(64) };
const actualPin = { sdk: pin.sdk, runtime: pin.runtime, referencePack: pin.referencePack, roslyn: {...pin.roslyn,sha256:pin.roslyn.platformHashes[`${process.platform}-${process.arch}`]}, referenceAssemblies: pin.referenceAssemblies };

test('SDK, compiler bytes and reference assemblies are exact pins', () => {
  assert.doesNotThrow(() => assertPins(actualPin));
  for (const key of ['sdk', 'runtime', 'referencePack']) assert.throws(() => assertPins({ ...actualPin, [key]: '99.0.0' }), /mismatch/);
  assert.throws(() => assertPins({ ...actualPin, roslyn: { ...pin.roslyn, sha256: '0'.repeat(64) } }), /mismatch/);
  assert.throws(() => assertPins({ ...actualPin, referenceAssemblies: { ...pin.referenceAssemblies, count: 0 } }), /mismatch/);
  for(const [target,sha256] of Object.entries(pin.roslyn.platformHashes))assert.doesNotThrow(()=>assertPins({...actualPin,roslyn:{version:pin.roslyn.version,sha256}},pin,target));
  assert.throws(()=>assertPins({...actualPin,roslyn:{...actualPin.roslyn,sha256:pin.roslyn.platformHashes['linux-x64']}},pin,'win32-x64'),/mismatch/);
});

test('hosted image drift fails while local image limits remain explicit', () => {
  assert.equal(assertImage({}).pinnedImage, false);
  const windows = { GITHUB_ACTIONS: 'true', ImageOS: pin.images.windows.imageOS, ImageVersion: pin.images.windows.imageVersion };
  assert.equal(assertImage(windows, 'win32').pinnedImage, true);
  assert.throws(() => assertImage({ ...windows, ImageVersion: 'changed' }, 'win32'), /image drift/);
  assert.throws(() => assertImage({ GITHUB_ACTIONS: 'true' }, 'linux'), /pinned Linux container/);
  assert.equal(assertImage({ GITHUB_ACTIONS: 'true', SHARPFORGE_ORACLE_CONTAINER: pin.images.linux.container }, 'linux').pinnedImage, true);
  assert.equal(requireTarget('winui', 'darwin-arm64').supported, false);
  assert.equal(requireTarget('winui', 'win32-x64').supported, true);
  assert.equal(requireTarget('coreclr', 'linux-riscv64').supported, false);
  assert.equal(planTargets('winui', 'darwin-arm64').filter(value => value.supported).length, 0);
  assert.equal(planTargets('all', 'win32-x64').filter(value => value.supported).length, 3);
  assert.equal(planTargets('all', 'linux-riscv64').filter(value => value.supported).length, 0);
});

test('fixture identity includes source bytes and language boundary', async () => {
  const fixture = await loadFixture(definition);
  const otherLanguage = await loadFixture({ ...definition, langVersion: '11.0' });
  assert.notEqual(fixture.inputHash, otherLanguage.inputHash);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'oracle-fixture-test-'));
  try {
    await writeFile(path.join(directory, 'Hello.cs'), `${fixture.sourceBytes}\n// changed`);
    const changed = await loadFixture(definition, directory);
    assert.notEqual(fixture.inputHash, changed.inputHash);
    await assert.rejects(loadFixture({ ...definition, source: '../Hello.cs' }), /simple .cs/);
    await assert.rejects(loadFixture({ ...definition, langVersion: 'preview' }), /Unpinned/);
    await assert.rejects(loadFixture({ ...definition, id: '../bad' }), /Invalid fixture id/);
    if (process.platform !== 'win32') {
      await symlink(path.join(oracleRoot, 'sources/Hello.cs'), path.join(directory, 'Escaped.cs'));
      await assert.rejects(loadFixture({ ...definition, source: 'Escaped.cs' }, directory), /symlink/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('expected schema rejects unknown, malformed, stale, wrong-oracle and wrong-path evidence', async () => {
  const fixtures = await loadFixtures();
  const fixture = fixtures.find(value => value.id === definition.id);
  const entry = envelope('roslyn', fixture, syntheticResult);
  assert.equal(validateSchema(entry), true);
  await verifyEntry(entry, fixtures, expectedPath(entry));
  for (const invalid of [
    { ...entry, extra: 1 }, { ...entry, inputHash: '../escape' }, { ...entry, result: { ...syntheticResult, exitCode: 2 } },
    { ...entry, result: { ...syntheticResult, diagnostics: [{ id: 'BAD', severity: 'error', source: null, span: null }] } },
  ]) assert.throws(() => validateSchema(invalid));
  await assert.rejects(verifyEntry({ ...entry, inputHash: '0'.repeat(64) }, fixtures), /Stale input hash/);
  await assert.rejects(verifyEntry({ ...entry, toolVersion: 'other' }, fixtures), /Stale tool version/);
  await assert.rejects(verifyEntry({ ...entry, oracleId: 'coreclr', toolVersion: pin.runtime }, fixtures), /Wrong result shape/);
  await assert.rejects(verifyEntry(entry, fixtures, path.join(root, 'wrong.json')), /path\/key mismatch/);
  assert.throws(() => validateSchema(1, { type: 'integer', unsupportedKeyword: true }), /Unsupported schema/);
});

test('expected store writes canonical bytes twice and rejects corrupt/stale data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'oracle-store-test-'));
  try {
    const fixture = await loadFixture(definition);
    const entry = envelope('roslyn', fixture, syntheticResult);
    const file = await writeExpected(entry, directory);
    const first = await readFile(file);
    await writeExpected(entry, directory);
    assert.deepEqual(await readFile(file), first);
    await compareExpected(entry, directory);
    assert.equal((await verifyStore(directory)).entries, 1);
    await writeFile(file, JSON.stringify({ ...entry, inputHash: 'f'.repeat(64) }));
    await assert.rejects(verifyStore(directory), /Stale input hash/);
    await assert.rejects(compareExpected(entry, directory), /mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('command modes are explicit and cannot accidentally update expected outputs', () => {
  assert.equal(parseArguments([]).mode, 'verify');
  assert.equal(parseArguments(['--capture']).mode, 'capture');
  assert.throws(() => parseArguments(['--capture', '--update']), /Select one/);
  assert.throws(() => parseArguments(['--oracle', 'fake']), /Oracle must/);
  assert.throws(() => parseArguments(['--simulate']), /Unknown/);
  assert.throws(() => assertDeterministic({ stdout: 'a' }, { stdout: 'b' }, 'fixture'), /Nondeterministic/);
});

test('native process cancellation, timeout, overflow, start failure and limit boundaries', async () => {
  const controller = new AbortController();
  const waiting = runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(waiting, /cancelled/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 30 }), /timed out/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("a".repeat(10000))'], { maxOutputBytes: 10 }), /output limit/);
  await assert.rejects(runProcess('sharpforge-oracle-no-such-executable', []), /ENOENT/);
  assert.throws(() => runProcess(process.execPath, [], { timeoutMs: 0 }), /positive/);
  await assert.rejects(runProcess(process.execPath, [], { signal: controller.signal }), /before launch/);
});

test('unsupported WinUI is recorded without requiring an unrelated local SDK', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'oracle-unsupported-test-'));
  try {
    const result = await runProcess(process.execPath, ['scripts/conformance/oracle/qualify.js', '--oracle', 'winui', '--verify'], {
      cwd: root, env: { SHARPFORGE_RESULTS_DIR: directory, SHARPFORGE_ORACLE_DOTNET: 'sharpforge-deliberately-absent-dotnet' },
    });
    assert.equal(result.exitCode, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'unsupported');
    assert.equal(report.observations, 0);
    assert.equal(report.unsupported[0].oracleId, 'winui');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('workflow pins SDK/container/image and always publishes qualification evidence', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/oracles.yml'), 'utf8');
  assert.ok(workflow.includes(pin.images.linux.container));
  assert.ok(workflow.includes(`dotnet-version: '${pin.sdk}'`));
  assert.ok(workflow.includes('if: always()'));
  assert.ok(workflow.includes('scripts/conformance/clean-checkout.js'));
  assert.ok(workflow.includes('scripts/conformance/oracle/qualify.js --verify'));
  const global = JSON.parse(await readFile(path.join(oracleRoot, 'global.json'), 'utf8'));
  assert.deepEqual(global.sdk, { version: pin.sdk, rollForward: 'disable', allowPrerelease: false });
  const lock = JSON.parse(await readFile(path.join(oracleRoot, 'WinUI/packages.lock.json'), 'utf8'));
  const appSDK = Object.values(lock.dependencies).find(value => value['Microsoft.WindowsAppSDK'])['Microsoft.WindowsAppSDK'];
  assert.equal(appSDK.resolved, pin.windowsAppSDK);
  assert.equal(appSDK.requested, `[${pin.windowsAppSDK}, ${pin.windowsAppSDK}]`);
});
