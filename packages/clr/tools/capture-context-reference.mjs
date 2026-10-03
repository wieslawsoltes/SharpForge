import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(process.argv[2] ?? join(root, 'artifacts/clr-context-reference'));
const temporary = mkdtempSync(join(tmpdir(), 'sharpforge-context-reference-'));
const run = (args, cwd = temporary) => execFileSync('dotnet', args, {
  cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' },
});

function project(directory, name, version, executable) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${name}.csproj`), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>
    <TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable>
    <AssemblyName>${name}</AssemblyName><AssemblyVersion>${version}</AssemblyVersion>
    <OutputType>${executable ? 'Exe' : 'Library'}</OutputType></PropertyGroup></Project>`);
}

function build(directory) {
  run(['build', '--configuration', 'Release', '--nologo', '--verbosity', 'quiet', '--disable-build-servers', '-m:1'], directory);
}

try {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(temporary, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>');
  const sdk = run(['--version']).trim();
  const images = [];
  for (const version of [1, 2]) {
    const directory = join(temporary, `v${version}`);
    project(directory, 'Plugin', `${version}.0.0.0`, false);
    writeFileSync(join(directory, 'Widget.cs'), `public class Widget { public int Value => ${version}; }`);
    build(directory);
    images.push(join(directory, 'bin/Release/net10.0/Plugin.dll'));
  }
  const oracle = join(temporary, 'oracle');
  project(oracle, 'oracle', '1.0.0.0', true);
  copyFileSync(join(root, 'tests/fixtures/clr-contexts/Program.cs'), join(oracle, 'Program.cs'));
  build(oracle);
  const expected = JSON.parse(run([join(oracle, 'bin/Release/net10.0/oracle.dll'), ...images]));
  if (!expected.liveInstanceRetainsContext || !expected.collectedAfterRelease) throw new Error('Native collectible context probe failed');
  const fixture = { sdk, ...expected, images: images.map(path => readFileSync(path).toString('base64')) };
  writeFileSync(join(output, 'native-contexts.json'), JSON.stringify(fixture, null, 2) + '\n');
  console.log(`Captured native assembly-context fixture in ${output}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
