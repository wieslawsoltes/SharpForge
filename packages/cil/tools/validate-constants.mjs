import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { encodeConstant, decodeConstant } from '@sharpforge/cil';

const source = fileURLToPath(new URL('../../../tests/fixtures/constants/ConstantOracle', import.meta.url));
const fixture = new URL('../../../tests/fixtures/constants/roslyn.json', import.meta.url);
const scratch = await mkdtemp(join(tmpdir(), 'sharpforge-constants-'));
const revive = (key, value) => value?.utf16 ? String.fromCharCode(...value.utf16)
  : value?.integer !== undefined ? BigInt(value.integer)
  : value?.number !== undefined ? (value.number === '-NaN' ? -NaN : Number(value.number)) : value;
const run = args => execFileSync('dotnet', args, { encoding: 'utf8', stdio: 'pipe', maxBuffer: 4 * 1024 * 1024 });
try {
  const output = join(scratch, 'bin/');
  run(['build', join(source, 'ConstantOracle.csproj'), '-c', 'Release', '-m:1', '--disable-build-servers',
    `-p:BaseOutputPath=${output}`, `-p:BaseIntermediateOutputPath=${join(scratch, 'obj/')}`]);
  const raw = run([join(output, 'Release/net10.0/ConstantOracle.dll'), source]);
  const data = JSON.parse(raw, revive);
  for (const item of data.cases) {
    const expected = Uint8Array.from(Buffer.from(item.blob, 'hex'));
    assert.deepEqual(item.value, item.srm, `${item.id} native reflection/SRM agreement`);
    assert.deepEqual(encodeConstant(item.type, item.value), { type: item.type, bytes: expected }, item.id);
    assert.deepEqual(decodeConstant(item.type, expected), item.value, item.id);
  }
  if (process.argv.includes('--capture-fixtures')) await writeFile(fixture, raw);
  else assert.deepEqual(data, JSON.parse(await readFile(fixture, 'utf8'), revive));
  console.log(JSON.stringify({ runtime: data.runtime, cases: data.cases.length,
    comparison: 'Roslyn Constant blobs, SRM ReadConstant and reflection RawConstantValue/RawDefaultValue' }));
} finally { await rm(scratch, { recursive: true, force: true }); }
