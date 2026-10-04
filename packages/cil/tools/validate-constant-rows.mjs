import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constantRowImage } from '../../../tests/fixtures/constant-rows/image.mjs';

const fixture = new URL('../../../tests/fixtures/constant-rows/native.json', import.meta.url);
const project = fileURLToPath(new URL('../../../tests/fixtures/constant-rows/oracle/ConstantRows.csproj', import.meta.url));
const expected = [
  { parent: 0x04000001, flags: 0x8056, type: 8, blob: '2A000000', value: 42 },
  { parent: 0x08000001, flags: 0x1010, type: 8, blob: 'F9FFFFFF', value: -7 },
  { parent: 0x17000001, flags: 0x1200, type: 14, blob: '7400650078007400', value: 'text' },
];
const scratch = await mkdtemp(join(tmpdir(), 'sharpforge-constant-rows-'));
const run = args => execFileSync('dotnet', args, { encoding: 'utf8', stdio: 'pipe', maxBuffer: 2 * 1024 * 1024 });
try {
  const image = join(scratch, 'ConstantRows.dll');
  const output = join(scratch, 'bin/');
  await writeFile(image, constantRowImage());
  run(['build', project, '-c', 'Release', '-m:1', '--disable-build-servers',
    `-p:BaseOutputPath=${output}`, `-p:BaseIntermediateOutputPath=${join(scratch, 'obj/')}`]);
  const raw = run([join(output, 'Release/net10.0/ConstantRows.dll'), image]);
  const actual = JSON.parse(raw);
  assert.deepEqual(actual.rows, expected);
  if (process.argv.includes('--capture-fixtures')) await writeFile(fixture, raw);
  else assert.deepEqual(actual, JSON.parse(await readFile(fixture, 'utf8')));
  console.log(JSON.stringify({ runtime: actual.runtime, rows: actual.rows.length,
    verified: 'SRM parent flags, GetDefaultValue, raw blob and decoded value' }));
} finally { await rm(scratch, { recursive: true, force: true }); }
