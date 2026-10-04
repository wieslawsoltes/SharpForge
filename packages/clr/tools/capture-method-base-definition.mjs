import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(process.argv[2] ?? join(root, 'artifacts/clr-method-base-definition'));
const source = resolve(process.argv[3] ?? join(root, 'tests/fixtures/clr-method-base-definition/Program.cs'));
const temporary = mkdtempSync(join(tmpdir(), 'sharpforge-method-base-'));
const run = args => execFileSync('dotnet', args, {
  cwd: temporary, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
  env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' },
});
try {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(temporary, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>');
  writeFileSync(join(temporary, 'oracle.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>
    <TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable>
    <OutputType>Exe</OutputType></PropertyGroup></Project>`);
  copyFileSync(source, join(temporary, 'Program.cs'));
  const sdk = run(['--version']).trim();
  run(['build', '--configuration', 'Release', '--nologo', '--verbosity', 'quiet', '--disable-build-servers', '-m:1']);
  const image = join(temporary, 'bin/Release/net10.0/oracle.dll');
  const expected = JSON.parse(run([image]));
  const records = expected.records.map(record => `    ${JSON.stringify(record)}`).join(',\n');
  const harnessBytes = readFileSync(image);
  const imageBytes = expected.image ? Buffer.from(expected.image, 'base64') : harnessBytes;
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const constraintCases = expected.constraintCases?.map(record => ({ ...record,
    imageSHA256: hash(Buffer.from(record.image, 'base64')) }));
  const header = JSON.stringify({ sdk, runtime: expected.runtime,
    sourceSHA256: hash(readFileSync(source)), imageSHA256: hash(imageBytes),
    ...(expected.image ? { harnessSHA256: hash(harnessBytes) } : {}),
    ...(constraintCases ? { constraintCases } : {}) }, null, 2).slice(0, -2);
  writeFileSync(join(output, 'native-method-bases.json'), `${header},\n  "records": [\n${records}\n  ],\n` +
    `  "image": ${JSON.stringify(imageBytes.toString('base64'))}\n}\n`);
  console.log(`Captured ${expected.records.length} native method base-definition records in ${output}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
