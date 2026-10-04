/**
 * Verifies source code that overrides and implements imported members against real .NET (SF-A02-T30).
 *
 *   node packages/compiler/test/imported-signatures/verify-dotnet.mjs [--update] [--dotnet <path>] [--scratch <dir>]
 *
 * Roslyn builds Library.cs and, against it, Consumer.cs; .NET runs that (the reference output, pinned in
 * Consumer.out with `--update`, which also rewrites the checked-in Library.dll). SharpForge compiles Consumer.cs
 * against Library.dll and the reference pack with `compileToAssembly`, and the same runtime runs that. Both outputs
 * must equal the pinned one. Needs a .NET SDK; the unit tests (tests/compiler-imported-signatures.test.js) only read
 * Library.dll.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToAssembly, createReferenceSet } from '@sharpforge/compiler';
import { locateReferencePack, readReferenceFiles } from '@sharpforge/compiler/node';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const home = join(homedir(), '.dotnet', 'dotnet');
const dotnet = option('--dotnet') ?? process.env.DOTNET ?? (existsSync(home) ? home : 'dotnet');
const scratch = resolve(option('--scratch') ?? 'node_modules/.sf/imported-signatures');
const update = args.includes('--update');
const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };
const run = (file, parameters) => execFileSync(file, parameters, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r\n/g, '\n');

const common = `<TargetFramework>net$(BundledNETCoreAppTargetFrameworkVersion)</TargetFramework>
    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <LangVersion>preview</LangVersion>
    <Deterministic>true</Deterministic>
    <DebugType>none</DebugType>
    <InvariantGlobalization>true</InvariantGlobalization>`;
const libraryProject = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <AssemblyName>Library</AssemblyName>
    ${common}
  </PropertyGroup>
</Project>
`;
const consumerProject = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <AssemblyName>Reference</AssemblyName>
    <UseAppHost>false</UseAppHost>
    ${common}
  </PropertyGroup>
  <ItemGroup><Reference Include="Library"><HintPath>../library/out/Library.dll</HintPath></Reference></ItemGroup>
</Project>
`;

function build(directory, project, source, name) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name + '.csproj'), project);
  copyFileSync(join(here, source), join(directory, source));
  run(dotnet, ['build', join(directory, name + '.csproj'), '-c', 'Release', '-o', join(directory, 'out'), '--nologo', '-v', 'q']);
}

const pack = locateReferencePack();
if (!pack) throw new Error('No .NET reference pack (packs/Microsoft.NETCore.App.Ref) was found; set DOTNET_ROOT');
let failed = 0;
try {
  const library = join(scratch, 'library'),
    consumer = join(scratch, 'consumer'),
    emitted = join(scratch, 'emitted');
  build(library, libraryProject, 'Library.cs', 'library');
  if (update) copyFileSync(join(library, 'out', 'Library.dll'), join(here, 'Library.dll'));
  build(consumer, consumerProject, 'Consumer.cs', 'consumer');
  const expected = run(dotnet, [join(consumer, 'out', 'Reference.dll')]);
  if (update) writeFileSync(join(here, 'Consumer.out'), expected);
  const pinned = readFileSync(join(here, 'Consumer.out'), 'utf8').replace(/\r\n/g, '\n');
  if (expected !== pinned) {
    failed++;
    console.log('the Roslyn build no longer prints Consumer.out; run with --update');
  }
  const references = createReferenceSet(readReferenceFiles([...pack.files, join(here, 'Library.dll')])),
    result = compileToAssembly(readFileSync(join(here, 'Consumer.cs'), 'utf8'), { name: 'Consumer', references });
  if (!result.assembly) {
    failed++;
    const errors = result.diagnostics.filter(entry => entry.severity === 'error');
    console.log('NOT EMITTED - ' + errors.map(entry => `${entry.code} ${entry.message}`).join('; '));
  } else {
    mkdirSync(emitted, { recursive: true });
    writeFileSync(join(emitted, 'Consumer.dll'), result.assembly);
    copyFileSync(join(here, 'Library.dll'), join(emitted, 'Library.dll'));
    copyFileSync(join(consumer, 'out', 'Reference.runtimeconfig.json'), join(emitted, 'Consumer.runtimeconfig.json'));
    let actual;
    try {
      actual = run(dotnet, [join(emitted, 'Consumer.dll')]);
    } catch (error) {
      actual = `${error.stdout ?? ''}\n<failed: ${String(error.stderr ?? error.message).split('\n')[0]}>`;
    }
    if (actual !== pinned) {
      failed++;
      console.log('  expected: ' + JSON.stringify(pinned).slice(0, 600));
      console.log('  actual:   ' + JSON.stringify(actual).slice(0, 600));
    }
    console.log(`Consumer: .NET ${actual === pinned ? 'equal' : 'DIFFERENT'} (compiled against Library.dll and the ${pack.version} references)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
