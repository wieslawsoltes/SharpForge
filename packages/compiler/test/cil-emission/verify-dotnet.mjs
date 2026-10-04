/**
 * Verifies direct CIL emission against real .NET (SF-A02-T30).
 *
 *   node packages/compiler/test/cil-emission/verify-dotnet.mjs [--update] [--only <name>] [--dotnet <path>] [--scratch <dir>]
 *                                                             [--references]
 *
 * For every fixture: Roslyn builds the program and .NET runs it (the reference output, pinned in `<name>.out` with
 * `--update`); SharpForge emits the assembly with `compileToAssembly` and the same .NET runtime runs that. Both
 * outputs must equal the pinned one. `--update` also rewrites `<name>.vm` with what the direct-CIL runtime reports
 * for the emitted assembly (the file is removed when it runs there) and `<name>.image` with what the metadata validator
 * reports for it (removed when it reports nothing). Needs a .NET SDK; the unit tests do not.
 *
 * `--references` compiles against the reference pack of the installed SDK instead of the framework registry, so the
 * emitted assembly names the members real .NET has; it then also runs `reference-fixtures/`, the programs that bind
 * only against real references. The `.vm` / `.image` files describe the registry build and are left alone.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { loadFixtures, emitFixture, inspectImage, runOnDirectCil, referenceFixtureDirectory } from './harness.js';

const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const home = join(homedir(), '.dotnet', 'dotnet');
const dotnet = option('--dotnet') ?? process.env.DOTNET ?? (existsSync(home) ? home : 'dotnet');
const scratch = resolve(option('--scratch') ?? 'node_modules/.sf/cil-emission');
const update = args.includes('--update');
const only = option('--only');
const withReferences = args.includes('--references');
const pack = withReferences ? loadReferencePack() : null;
if (withReferences && !pack) throw new Error('No .NET reference pack (packs/Microsoft.NETCore.App.Ref) was found; set DOTNET_ROOT');
const compileOptions = pack ? { references: pack.references } : {};
const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };
const run = (file, parameters) =>
  execFileSync(file, parameters, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r\n/g, '\n');

const project = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net$(BundledNETCoreAppTargetFrameworkVersion)</TargetFramework>
    <AssemblyName>Reference</AssemblyName>
    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <UseAppHost>false</UseAppHost>
    <InvariantGlobalization>true</InvariantGlobalization>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
    <NoWarn>CS0414;CS0649;CS0067;CS0169;CS0219;CS0168;CS8321;CS0162</NoWarn>
  </PropertyGroup>
</Project>
`;
const runtimeConfig = version =>
  JSON.stringify({
    runtimeOptions: {
      tfm: 'net' + version,
      framework: { name: 'Microsoft.NETCore.App', version: version + '.0' },
      configProperties: { 'System.Globalization.Invariant': true },
    },
  });

const reference = join(scratch, 'reference'),
  emitted = join(scratch, 'emitted');
mkdirSync(reference, { recursive: true });
mkdirSync(emitted, { recursive: true });
writeFileSync(join(reference, 'reference.csproj'), project);
const runtimeVersion = run(dotnet, ['--version']).trim().split('.').slice(0, 2).join('.');
writeFileSync(join(emitted, 'Fixture.runtimeconfig.json'), runtimeConfig(runtimeVersion));

/** What Roslyn and .NET print for a program. */
function referenceOutput(fixture) {
  writeFileSync(join(reference, 'Program.cs'), fixture.source);
  run(dotnet, ['build', join(reference, 'reference.csproj'), '-c', 'Release', '-o', join(reference, 'out'), '--nologo', '-v', 'q']);
  return run(dotnet, [join(reference, 'out', 'Reference.dll')]);
}

/** Runs the registry build on the direct-CIL runtime; with `--update` pins its limits (`.vm`, `.image`). */
function directCilAxis(fixture, assembly, expected) {
  const directCil = runOnDirectCil(assembly),
    limitFile = join(fixture.directory, fixture.name + '.vm'),
    matches = directCil.limit === null && directCil.output === expected;
  if (update) {
    if (matches) rmSync(limitFile, { force: true });
    else writeFileSync(limitFile, directCil.limit ?? 'output differs\n');
    const problems = inspectImage(assembly),
      imageFile = join(fixture.directory, fixture.name + '.image');
    if (problems.length) writeFileSync(imageFile, problems.join('\n') + '\n');
    else rmSync(imageFile, { force: true });
  }
  return matches ? 'equal' : `limited (${(directCil.limit ?? 'output differs').split('\n')[0]})`;
}

let failed = 0;
const fixtures = [...loadFixtures(), ...(withReferences ? loadFixtures(referenceFixtureDirectory) : [])].filter(
  fixture => !only || fixture.name === only,
);
for (const fixture of fixtures) {
  let expected = fixture.expected;
  if (update || expected === null) {
    expected = referenceOutput(fixture);
    writeFileSync(join(fixture.directory, fixture.name + '.out'), expected);
  }
  const { assembly, errors } = emitFixture(fixture, compileOptions);
  if (!assembly) {
    failed++;
    console.log(`${fixture.name}: NOT EMITTED - ${errors.join('; ')}`);
    continue;
  }
  writeFileSync(join(emitted, 'Fixture.dll'), assembly);
  let actual;
  try {
    actual = run(dotnet, [join(emitted, 'Fixture.dll')]);
  } catch (error) {
    actual = `${error.stdout ?? ''}\n<failed: ${String(error.stderr ?? error.message).split('\n')[0]}>`;
  }
  const onDotnet = actual === expected ? 'equal' : 'DIFFERENT';
  if (withReferences) console.log(`${fixture.name}: .NET ${onDotnet} (compiled against the ${pack.pack.version} references)`);
  else console.log(`${fixture.name}: .NET ${onDotnet}; direct-CIL runtime ${directCilAxis(fixture, assembly, expected)}`);
  if (actual !== expected) {
    failed++;
    console.log('  expected: ' + JSON.stringify(expected).slice(0, 400));
    console.log('  actual:   ' + JSON.stringify(actual).slice(0, 400));
  }
}
console.log(`${fixtures.length - failed}/${fixtures.length} fixtures print on .NET ${runtimeVersion} what the Roslyn build prints`);
process.exitCode = failed ? 1 : 0;
