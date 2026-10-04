import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSdkEnvironment } from '../packages/msbuild/src/sdk-discovery.js';
import { findGlobalJson, resolveSdk } from '../packages/msbuild/src/global-json.js';
import { runNativeProcess } from '../packages/msbuild/src/process.js';

const executable = process.env.SHARPFORGE_DOTNET;

test('global.json selection matches actual dotnet --version for twelve policy combinations', {
  skip: executable ? false : 'Set SHARPFORGE_DOTNET for the installed CLI selection oracle', timeout: 90000
}, async t => {
  const inventory = await discoverSdkEnvironment({ executable });
  assert.equal(inventory.available, true, inventory.error);
  const installed = inventory.sdks.filter(sdk => !sdk.preview);
  const latest = installed.at(-1)?.version;
  assert(latest, 'An installed stable SDK is needed');
  const [major, minor, patch] = latest.split('.').map(Number);
  const floor = `${major}.${minor}.${Math.floor(patch / 100) * 100}`;
  const nextBand = `${major}.${minor}.${(Math.floor(patch / 100) + 1) * 100}`;
  const cases = [
    { version: latest, rollForward: 'disable' }, { version: nextBand, rollForward: 'disable' },
    { version: latest, rollForward: 'patch' }, { version: floor, rollForward: 'patch' },
    { version: floor, rollForward: 'latestPatch' }, { version: `${major}.${minor}.100`, rollForward: 'feature' },
    { version: `${major}.${minor}.100`, rollForward: 'latestFeature' }, { version: nextBand, rollForward: 'minor' },
    { version: floor, rollForward: 'latestMinor' }, { version: `${major - 1}.0.999`, rollForward: 'major' },
    { version: floor, rollForward: 'latestMajor', allowPrerelease: false },
    { version: `${major + 1}.0.100`, rollForward: 'major' }
  ];
  const root = await mkdtemp(join(tmpdir(), 'sf-global-json-reference-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'nested', 'project');
  await mkdir(directory, { recursive: true });
  const observations = [];
  for (const configuration of cases) {
    const text = '{\n// SDK policy fixture: unicode ł🙂\n"sdk":' + JSON.stringify(configuration) + '\n}\n';
    await writeFile(join(root, 'global.json'), text);
    const parsed = await findGlobalJson(directory);
    assert.equal(parsed.path, join(root, 'global.json'));
    const expected = resolveSdk(parsed.value, inventory.sdks, { allowPrerelease: true }).selected?.version ?? null;
    const native = await runNativeProcess({ executable, arguments: ['--version'], cwd: directory,
      timeoutMs: 10000, maxOutputBytes: 65536 });
    const actual = native.exitCode === 0 ? native.stdout.trim() : null;
    assert.equal(actual, expected, JSON.stringify({ configuration, expected, actual, stderr: native.stderr }));
    if (!expected) assert.match(native.stderr, /compatible|SDK|global.json/i);
    observations.push({ ...configuration, selected: actual, exitCode: native.exitCode });
  }
  await writeFile(join(root, 'global.json'), '{ "sdk": { "version": "' + latest + '", }, }');
  await assert.rejects(findGlobalJson(directory), error => error.code === 'SFJSON001' && /Trailing commas/.test(error.message));
  t.diagnostic(JSON.stringify({ node: process.version, installed: inventory.sdks.map(item => item.version), observations }));
});
