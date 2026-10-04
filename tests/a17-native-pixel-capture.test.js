import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pin } from '../scripts/conformance/oracle/toolchain.js';
import { directory } from './rendering/native/input.js';
import { hash } from './rendering/native/contract.js';
import { captureNative } from './rendering/native/capture.js';
import { fakeNativePixels } from './fixtures/rendering/native-pixel-capture.js';

async function optionsFor(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-native-capture-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const sourceRoot = path.join(temporary, 'source');
  await cp(directory, sourceRoot, { recursive: true });
  const catalogPath = path.join(sourceRoot, 'fixtures.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  catalog.fixtures = [catalog.fixtures[1], catalog.fixtures.at(-1)];
  await writeFile(catalogPath, JSON.stringify(catalog));
  return { output: path.join(temporary, 'capture'), sourceRoot, temporaryRoot: temporary, target: 'win32-x64',
    windowsBuild: pin.images.windows.minimumBuild,
    resolve: async () => ({ dotnet: 'fixture-only-dotnet', actual: { fixtureOnly: true }, environment: { fixtureOnly: true } }),
    provenance: { sourceRevision: 'f'.repeat(40), sourceDirty: false, captureCommand: ['fixture-only', 'not-executed'] } };
}

test('native producer builds the existing lock once and exports only two-process-agreeing captured bytes', async t => {
  const options = await optionsFor(t), native = fakeNativePixels();
  const report = await captureNative({ ...options, execute: native.execute });
  assert.equal(report.status, 'captured-native-reference');
  assert.equal(report.attempts.length, 2);
  assert.equal(report.references.length, 1);
  assert.equal(native.calls.filter(call => call.args[0] === 'restore').length, 1);
  assert(native.calls[0].args.includes('--locked-mode'));
  assert.equal(native.calls.filter(call => call.args[0] === 'build').length, 1);
  const reference = report.references[0];
  const bytes = gunzipSync(await readFile(path.join(options.output, reference.id + '.rgba.gz')));
  assert.deepEqual([...bytes.subarray(0, 8)], [3, 2, 1, 255, 0, 0, 0, 0]);
  assert.equal(hash(bytes), reference.pixelSha256);
  const metadata = JSON.parse(await readFile(path.join(options.output, reference.id + '.json'), 'utf8'));
  assert.equal(metadata.toolVersion, 'fixture-only-never-executed');
  assert.equal(metadata.fixture.dpr, 1.5);
  assert.equal(metadata.nativeEnvironment.rasterizationScale, 1.25);
  assert.equal(metadata.windowsAppSdkVersion, pin.windowsAppSDK);
  assert.equal(metadata.inputHash, report.inputHash);
  assert((await readdir(path.join(options.output, 'attempt-1'))).includes(reference.id + '.bgra'));
  assert(!(await readdir(options.output)).some(name => name.startsWith('native-xaml-invalid-property.')));
  assert.deepEqual((await readdir(options.temporaryRoot)).sort(), ['capture', 'source']);
});

test('nondeterministic pixels, corrupt native hashes and native stderr cannot become references', async t => {
  for (const fault of [{ changeSecond: true }, { corruptHash: true }, { stderr: 'fixture native failure' }]) {
    const options = await optionsFor(t), native = fakeNativePixels(fault);
    const report = await captureNative({ ...options, execute: native.execute });
    assert.equal(report.status, 'failed');
    assert.equal(report.references.length, 0);
    assert.match(report.failures[0], /SFNPIX02[12]/);
    assert(!(await readdir(options.output)).some(name => name.endsWith('.rgba.gz')));
    assert.deepEqual((await readdir(options.temporaryRoot)).sort(), ['capture', 'source']);
    assert.equal(JSON.parse(await readFile(path.join(options.output, 'report.json'), 'utf8')).status, 'failed');
  }
});

test('unsupported platforms do not resolve or launch a native host and do not produce reference files', async t => {
  const options = await optionsFor(t);
  const report = await captureNative({ ...options, target: 'linux-x64',
    resolve: () => assert.fail('Must not resolve Windows tools on an unsupported target'),
    execute: () => assert.fail('Must not launch Windows processes on an unsupported target') });
  assert.equal(report.status, 'unsupported');
  assert.equal(report.attempts.length, 0);
  assert.deepEqual(await readdir(options.output), ['report.json']);
  assert.match(report.unsupported[0].reason, /interactive desktop/);
});

test('pre-abort, in-flight cancellation and existing output preserve files and clean temporary projects', async t => {
  const options = await optionsFor(t), controller = new AbortController();
  controller.abort(new Error('fixture pre-abort'));
  await assert.rejects(captureNative({ ...options, signal: controller.signal }), /fixture pre-abort/);
  assert.deepEqual(await readdir(options.temporaryRoot), ['source']);
  const active = new AbortController();
  const native = fakeNativePixels({ onRestore: () => active.abort(new Error('fixture cancellation')) });
  const report = await captureNative({ ...options, signal: active.signal, execute: native.execute });
  assert.equal(report.status, 'cancelled');
  assert.equal(report.attempts.length, 0);
  assert.deepEqual((await readdir(options.temporaryRoot)).sort(), ['capture', 'source']);
  const before = await readFile(path.join(options.output, 'report.json'));
  await assert.rejects(captureNative({ ...options, execute: () => assert.fail('Must not overwrite an existing capture') }), /EEXIST/);
  assert.deepEqual(await readFile(path.join(options.output, 'report.json')), before);
});
