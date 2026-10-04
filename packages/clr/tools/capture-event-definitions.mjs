import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(process.argv[2] ?? join(root, 'artifacts/clr-event-definitions'));
const temporary = mkdtempSync(join(tmpdir(), 'sharpforge-events-'));
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
  copyFileSync(join(root, 'tests/fixtures/clr-event-definitions/Program.cs'), join(temporary, 'Program.cs'));
  const sdk = run(['--version']).trim();
  run(['build', '--configuration', 'Release', '--nologo', '--verbosity', 'quiet', '--disable-build-servers', '-m:1']);
  const image = join(temporary, 'bin/Release/net10.0/oracle.dll');
  const expected = JSON.parse(run([image]));
  // One record per line keeps the independent metadata comparison easy to scan.
  const events = expected.events.map(event => `    ${JSON.stringify(event)}`).join(',\n');
  const header = JSON.stringify({ sdk, runtime: expected.runtime }, null, 2).slice(0, -2);
  writeFileSync(join(output, 'native-events.json'), `${header},\n  "events": [\n${events}\n  ],\n` +
    `  "image": ${JSON.stringify(readFileSync(image).toString('base64'))}\n}\n`);
  console.log(`Captured ${expected.events.length} native event fixtures in ${output}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
