import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMarshalDescriptor } from '@sharpforge/cil';

const fixture = new URL('../../../tests/fixtures/marshal-descriptors/', import.meta.url);
const project = fileURLToPath(new URL('oracle/MarshalDescriptors.csproj', fixture));
const scratch = await mkdtemp(join(tmpdir(), 'sharpforge-marshal-descriptors-'));
const run = args => execFileSync(process.env.DOTNET_PATH ?? 'dotnet', args, {
  encoding: 'utf8', stdio: 'pipe', timeout: 120000, maxBuffer: 2 * 1024 * 1024,
});
try {
  const output = join(scratch, 'bin/');
  run(['build', project, '-c', 'Release', '-m:1', '--disable-build-servers', '-p:UseSharedCompilation=false',
    `-p:BaseOutputPath=${output}`, `-p:BaseIntermediateOutputPath=${join(scratch, 'obj/')}`]);
  const actual = JSON.parse(run([join(output, 'Release/net10.0/MarshalDescriptors.dll')]));
  assert.equal(actual.records.length, 14);
  for (const record of actual.records) {
    const decoded = decodeMarshalDescriptor(Buffer.from(record.blob, 'hex'));
    assert.equal(decoded.type, record.type);
    for (const key of ['sizeConstant', 'sizeParameterIndex', 'iidParameterIndex', 'variantType', 'managedTypeName', 'cookie']) {
      if (Object.hasOwn(decoded, key)) assert.equal(decoded[key], record.srmTail[key] ?? record[key], record.name + ':' + key);
    }
    if (decoded.elementType && decoded.elementType.type !== 0x50) assert.equal(decoded.elementType.type, record.elementType);
    if (decoded.userDefinedType) assert.equal(decoded.userDefinedType, record.srmTail.userDefinedType);
  }
  const source = (await readFile(new URL('oracle/Program.cs', fixture), 'utf8')).replaceAll('\r\n', '\n');
  actual.sdk = run(['--version']).trim();
  actual.sourceSha256 = createHash('sha256').update(source).digest('hex');
  actual.reflectionLimitations = 'COM subtype/IID and custom strings use SRM BlobReader; this CoreCLR host omits COM fields '
    + 'and returns an overlong MarshalType string. Those reflection properties are not claimed as passing.';
  if (process.argv.includes('--capture-fixtures')) await writeFile(new URL('native.json', fixture), JSON.stringify(actual, null, 2) + '\n');
  console.log(JSON.stringify({ runtime: actual.runtime, sdk: actual.sdk, descriptors: actual.records.length,
    verified: 'Roslyn descriptor bytes, reflection scalar/array properties and SRM extended tails; no native imports invoked' }));
} finally { await rm(scratch, { recursive: true, force: true }); }
