import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBinaryPermissionSet } from '@sharpforge/cil';

const fixture = new URL('../../../tests/fixtures/permission-sets/', import.meta.url);
const project = fileURLToPath(new URL('oracle/PermissionSets.csproj', fixture));
const scratch = await mkdtemp(join(tmpdir(), 'sharpforge-permission-sets-'));
const run = args => execFileSync(process.env.DOTNET_PATH ?? 'dotnet', args, {
  encoding: 'utf8', stdio: 'pipe', timeout: 120000, maxBuffer: 2 * 1024 * 1024,
});
try {
  const output = join(scratch, 'bin/');
  run(['build', project, '-c', 'Release', '-m:1', '--disable-build-servers', '-p:UseSharedCompilation=false',
    `-p:BaseOutputPath=${output}`, `-p:BaseIntermediateOutputPath=${join(scratch, 'obj/')}`]);
  const actual = JSON.parse(run([join(output, 'Release/net10.0/PermissionSets.dll')]));
  for (let count = 0; count < actual.cases.length; count++) {
    const result = decodeBinaryPermissionSet(Buffer.from(actual.cases[count].blob, 'hex'));
    const projected = result.attributes.map(attribute => ({ typeName: attribute.typeName,
      values: attribute.namedArguments.map(argument => ({ name: argument.name, isField: argument.isField,
        type: argument.value.type, value: argument.value.value })) }));
    assert.deepEqual(projected, actual.expected.slice(0, count));
  }
  const source = (await readFile(new URL('oracle/Program.cs', fixture), 'utf8')).replaceAll('\r\n', '\n');
  actual.sdk = run(['--version']).trim();
  actual.sourceSha256 = createHash('sha256').update(source).digest('hex');
  if (process.argv.includes('--capture-fixtures')) await writeFile(new URL('native.json', fixture), JSON.stringify(actual, null, 2) + '\n');
  console.log(JSON.stringify({ runtime: actual.runtime, sdk: actual.sdk, permissionSets: actual.cases.length,
    verified: 'Native SRM PermissionSetBlob/PermissionSetArguments encoding; no permission instantiation' }));
} finally { await rm(scratch, { recursive: true, force: true }); }
