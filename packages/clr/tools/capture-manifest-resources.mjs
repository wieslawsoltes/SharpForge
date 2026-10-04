import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(process.argv[2] ?? join(root, 'artifacts/clr-manifest-resources'));
const temporary = mkdtempSync(join(tmpdir(), 'sharpforge-manifest-resources-'));
const dotnet = process.env.SHARPFORGE_ORACLE_DOTNET ?? 'dotnet';
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const run = args => execFileSync(dotnet, args, { cwd: temporary, encoding: 'utf8',
  timeout: 120000, maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' } });

try {
  const sdk = run(['--version']).trim();
  if (!sdk.startsWith('10.')) throw new Error(`The reference harness requires the .NET 10 SDK; found ${sdk}`);
  const sdkLine = run(['--list-sdks']).split(/\r?\n/).find(line => line.startsWith(`${sdk} [`));
  if (!sdkLine?.endsWith(']')) throw new Error(`Cannot locate installed SDK ${sdk}`);
  const sdkRoot = sdkLine.slice(sdk.length + 2, -1);
  const readerPath = join(sdkRoot, sdk, 'System.Reflection.MetadataLoadContext.dll');
  const readerSha256 = digest(readerPath);
  copyFileSync(readerPath, join(temporary, 'System.Reflection.MetadataLoadContext.dll'));
  writeFileSync(join(temporary, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>');
  writeFileSync(join(temporary, 'oracle.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>
    <TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable>
    <OutputType>Exe</OutputType><EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <Deterministic>true</Deterministic></PropertyGroup><ItemGroup>
    <Compile Include="Images.cs" /><Compile Include="Program.cs" />
    <Reference Include="System.Reflection.MetadataLoadContext">
      <HintPath>System.Reflection.MetadataLoadContext.dll</HintPath>
    </Reference></ItemGroup></Project>`);
  const sourcePaths = ['Images.cs', 'Program.cs'].map(name => {
    const path = `tests/fixtures/clr-manifest-resources/${name}`;
    copyFileSync(join(root, path), join(temporary, name));
    return path;
  });
  sourcePaths.push('packages/clr/tools/capture-manifest-resources.mjs');
  const sources = sourcePaths.map(path => ({ path, sha256: digest(join(root, path)) }));
  run(['build', '--configuration', 'Release', '--nologo', '--verbosity', 'quiet', '--disable-build-servers', '-m:1']);
  const observations = JSON.parse(run([join(temporary, 'bin/Release/net10.0/oracle.dll'), join(temporary, 'images')]));
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'native-manifest-resources.json'), JSON.stringify({ sdk, sources,
    referenceReader: { name: 'System.Reflection.MetadataLoadContext.dll', sha256: readerSha256 }, ...observations }, null, 2) + '\n');
  console.log(`Captured CoreCLR and MetadataLoadContext manifest-resource outcomes in ${output}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
