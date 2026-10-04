import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { directory, loadInput, boundedRead } from './rendering/native/input.js';
import { validateCatalog } from './rendering/native/contract.js';

test('native capture input hashes its producer and locked project sources', async () => {
  const input = await loadInput();
  assert.equal(input.fixtures.length, 39);
  for (const name of ['Program.cs', 'NativeCapture.cs', 'ShapeDefaults.cs', 'capture.js',
    'native/packages.lock.json', 'native/Oracle.WinUI.csproj']) {
    assert(input.materials.some(row => row.name === name));
  }
  assert.match(input.inputHash, /^[a-f0-9]{64}$/);
});

test('native input fails closed for invalid identity, traversal, stale XAML or total pixel overflow', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-native-contract-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await cp(directory, temporary, { recursive: true });
  const file = path.join(temporary, 'fixtures.json');
  const original = JSON.parse(await readFile(file, 'utf8'));
  for (const mutate of [value => { value.fixtures[0].file = '../Program.cs'; },
    value => { value.fixtures[1].id = value.fixtures[0].id; }, value => { value.fixtures[0].dpr = Infinity; },
    value => { value.fixtures[0].xamlSha256 = 'e'.repeat(64); },
    value => { value.fixtures[0].focusTarget = '../unsafe'; },
    value => { for (const fixture of value.fixtures) Object.assign(fixture, { width: 2048, height: 2048, dpr: 1 }); }]) {
    const catalog = structuredClone(original);
    mutate(catalog);
    await writeFile(file, JSON.stringify(catalog));
    await assert.rejects(loadInput(temporary), /SFNPIX00[127]/);
  }
  assert.throws(() => validateCatalog({ ...original, fixtures: Array(129).fill(original.fixtures[0]) }), /SFNPIX002/);
});

test('native source reader rejects symlink escapes and oversized files before decoding', { skip: process.platform === 'win32' }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-native-symlink-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, 'outside');
  await writeFile(target, 'bytes');
  await cp(directory, path.join(temporary, 'harness'), { recursive: true });
  const link = path.join(temporary, 'harness', 'escape');
  await symlink(target, link);
  await assert.rejects(boundedRead(link, path.join(temporary, 'harness'), 1024), /SFNPIX007.*escapes/);
  await assert.rejects(boundedRead(target, temporary, 4), /SFNPIX007.*byte budget/);
});
