import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadInput, validateDump, captureWinUI } from './run.js';
import { pin } from '../toolchain.js';
const sourceRoot = new URL('./', import.meta.url);
const processResult = { exitCode: 0, signal: null, stdout: '', stderr: '', elapsedMs: 1 };
const dump = input => ({ schemaVersion: 1, inputHash: input.inputHash, runtime: pin.runtime, culture: 'en-US', theme: 'Light',
  winuiAssemblyVersion: 'fixture-only', observations: input.fixtures.map(fixture => fixture.expected === 'load-error'
    ? { id: fixture.id, status: 'load-error', exception: 'Fixture.XamlError', hresult: -1 }
    : { id: fixture.id, status: 'loaded', viewport: fixture.viewport, rasterizationScale: 1,
      layout: { path: '0', type: 'Fixture.Element', properties: { width: { value: 'NaN', hasLocalValue: false } }, children: [] }, automation: [] }) });
function fakeNative({ changeThird = false, stderr = '' } = {}) {
  let repetitions = 0;
  return async (command, args) => {
    if (args[0] === 'restore') return processResult;
    if (args[0] === 'build') {
      const out = args[args.indexOf('-o') + 1]; await mkdir(out);
      await writeFile(path.join(out, 'Oracle.WinUI.exe'), 'fake executable, never executed');
      return processResult;
    }
    const input = JSON.parse(await readFile(args[0], 'utf8')), observed = dump(input);
    if (++repetitions === 3 && changeThird) observed.observations[0].layout.properties.changed = true;
    await writeFile(args[1], JSON.stringify(observed));
    return { ...processResult, stderr };
  };
}
const resolve = async () => ({ dotnet: 'fake-dotnet', actual: { fixture: true }, environment: { fixture: true } });

test('WinUI input binds fixture bytes, viewport, native sources and pinned project files', async () => {
  const input = await loadInput();
  assert.equal(input.fixtures.length, 20);
  assert(input.fixtures.some(row => row.id === 'button-default'));
  assert.equal(new Set(input.fixtures.map(row => row.id)).size, input.fixtures.length);
  assert(input.materials.some(row => row.name === 'native/packages.lock.json'));
  assert(input.materials.some(row => row.name === 'Snapshot.cs'));
  assert.match(input.inputHash, /^[a-f0-9]{40,64}$/);
  assert.equal(validateDump(dump(input), input).observations.length, input.fixtures.length);
});

test('WinUI result rejects identity, fixture, culture and observation drift', async () => {
  const input = await loadInput(), valid = dump(input);
  for (const change of [value => { value.inputHash = 'wrong'; }, value => { value.culture = 'fr-FR'; },
    value => { value.theme = 'Dark'; }, value => value.observations.pop(),
    value => { value.observations[0].id = 'other'; }, value => { value.observations[0].automation = null; },
    value => { value.observations[0].viewport.width++; }]) {
    const value = structuredClone(valid); change(value); assert.throws(() => validateDump(value, input));
  }
});

test('WinUI catalog fails before building when IDs, paths or viewports are invalid', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-winui-input-'));
  try {
    await cp(sourceRoot, temporary, { recursive: true });
    const catalogPath = path.join(temporary, 'fixtures/index.json'), original = JSON.parse(await readFile(catalogPath, 'utf8'));
    for (const change of [value => { value.fixtures[0].viewport.width = 2049; }, value => { value.fixtures[0].file = '../Program.cs'; },
      value => { value.fixtures[1] = value.fixtures[0]; }, value => { value.fixtures[0].expected = 'invented'; },
      value => value.fixtures.pop()]) {
      const value = structuredClone(original); change(value); await writeFile(catalogPath, JSON.stringify(value));
      await assert.rejects(loadInput(temporary));
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('WinUI capture uses three serial fake processes and fails third-run instability', async () => {
  const options = { target: 'win32-x64', windowsBuild: pin.images.windows.minimumBuild, resolve };
  const captured = await captureWinUI({ ...options, execute: fakeNative() });
  assert.equal(captured.status, 'captured-not-baseline-qualified');
  assert.deepEqual(captured.attempts.map(row => row.number), [1, 2, 3]);
  assert(captured.binaries.some(row => row.name === 'Oracle.WinUI.exe'));
  assert.match(captured.attempts[0].output, /Fixture.Element/);
  const unstable = await captureWinUI({ ...options, execute: fakeNative({ changeThird: true }) });
  assert.equal(unstable.status, 'failed'); assert.match(unstable.failures[0], /Nondeterministic/);
  const failure = await captureWinUI({ ...options, execute: fakeNative({ stderr: 'native failure' }) });
  assert.equal(failure.status, 'failed'); assert.equal(failure.attempts[0].process.stderr, 'native failure');
});

test('non-Windows WinUI capture is explicitly unsupported without native resolution', async () => {
  const result = await captureWinUI({ target: 'darwin-arm64', resolve: async () => { throw new Error('Must not resolve native host'); } });
  assert.equal(result.status, 'unsupported'); assert.equal(result.attempts.length, 0); assert.equal(result.unsupported.length, 1);
});

test('intentional XAML failures retain native type and HRESULT and cannot become silent successes', async () => {
  const input = await loadInput(), result = dump(input);
  const negatives = input.fixtures.map((row, index) => row.expected === 'load-error' ? index : -1).filter(index => index >= 0);
  assert.equal(negatives.length, 2);
  for (const index of negatives) {
    assert.equal(validateDump(result, input).observations[index].exception, 'Fixture.XamlError');
    for (const patch of [{ exception: null }, { hresult: null }, { status: 'loaded' }]) {
      const changed = structuredClone(result); Object.assign(changed.observations[index], patch);
      assert.throws(() => validateDump(changed, input));
    }
  }
});
