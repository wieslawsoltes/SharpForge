import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(process.argv[2] ?? join(root, 'artifacts/clr-resources'));
const temporary = mkdtempSync(join(tmpdir(), 'sharpforge-resources-'));
const run = args => execFileSync('dotnet', args, {
  cwd: temporary, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' },
});
try {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(temporary, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>');
  writeFileSync(join(temporary, 'oracle.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>
    <TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable>
    <OutputType>Exe</OutputType><EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <EnableDefaultEmbeddedResourceItems>false</EnableDefaultEmbeddedResourceItems>
    </PropertyGroup><ItemGroup><Compile Include="Program.cs" />
    <EmbeddedResource Include="Sample.resx"><LogicalName>Oracle.Sample.resources</LogicalName></EmbeddedResource>
    </ItemGroup></Project>`);
  const sources = ['Program.cs', 'Sample.resx'].map(name => {
    const path = `tests/fixtures/clr-resources/${name}`;
    copyFileSync(join(root, path), join(temporary, name));
    return { path, sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex') };
  });
  const sdk = run(['--version']).trim();
  run(['build', '--configuration', 'Release', '--nologo', '--verbosity', 'quiet', '--disable-build-servers', '-m:1']);
  const expected = JSON.parse(run([join(temporary, 'bin/Release/net10.0/oracle.dll'), temporary]));
  writeFileSync(join(output, 'native-resources.json'), JSON.stringify({ sdk, sources, ...expected }, null, 2) + '\n');
  console.log(`Captured native ResourceWriter and MSBuild resgen fixtures in ${output}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
