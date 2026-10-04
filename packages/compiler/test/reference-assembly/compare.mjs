/**
 * Compares reference-assembly emission with Roslyn through real .NET reflection (SF-A02-T29).
 *
 *   node packages/compiler/test/reference-assembly/compare.mjs [--dotnet <path>] [--scratch <dir>] [--update]
 *
 * For every `*.cs` sample here: Roslyn builds it as a library, SharpForge emits its reference assembly, and
 * `Program.cs` (built once into the scratch directory) loads each image with the runtime and prints its declarations.
 * Loading runs the CLR's own checks: layout, interface implementation, overrides, signatures.
 * The dumps must agree line for line, except for the lines listed in `<sample>.pending.txt` (declarations Roslyn has
 * and SharpForge does not write yet). `--update` rewrites `<sample>.roslyn.txt`, the pinned Roslyn dump.
 * Needs a .NET SDK; the unit tests (tests/compiler-reference-assembly.test.js) do not.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { compileToReferenceAssembly } from '@sharpforge/compiler';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const home = join(homedir(), '.dotnet', 'dotnet');
const dotnet = option('--dotnet') ?? process.env.DOTNET ?? (existsSync(home) ? home : 'dotnet');
const scratch = resolve(option('--scratch') ?? 'node_modules/.sf/reference-assembly');
const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };
const run = (file, parameters, options = {}) => execFileSync(file, parameters, { env, encoding: 'utf8', ...options });
const build = project => run(dotnet, ['build', project, '-c', 'Release', '-o', join(dirname(project), 'out'), '--nologo', '-v', 'q'], { stdio: 'inherit' });

const libraryProject = name => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Library</OutputType>
    <TargetFramework>net$(BundledNETCoreAppTargetFrameworkVersion)</TargetFramework>
    <AssemblyName>${name}</AssemblyName>
    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
    <NoWarn>CS0414;CS0649;CS0067;CS0169</NoWarn>
  </PropertyGroup>
</Project>
`;

const tool = join(scratch, 'tool');
mkdirSync(tool, { recursive: true });
for (const file of ['Program.cs', 'reflect.csproj']) copyFileSync(join(here, file), join(tool, file));
build(join(tool, 'reflect.csproj'));
const dump = assembly => run(dotnet, [join(tool, 'out', 'reflect.dll'), assembly]).replace(/\r\n/g, '\n');

let failed = false;
for (const sample of readdirSync(here).filter(name => name.endsWith('.cs') && name !== 'Program.cs').sort()) {
  const name = basename(sample, '.cs'),
    assemblyName = name[0].toUpperCase() + name.slice(1),
    source = readFileSync(join(here, sample), 'utf8'),
    library = join(scratch, name);
  mkdirSync(library, { recursive: true });
  writeFileSync(join(library, 'Source.cs'), source);
  writeFileSync(join(library, 'library.csproj'), libraryProject(assemblyName));
  build(join(library, 'library.csproj'));
  const expected = dump(join(library, 'out', assemblyName + '.dll'));
  if (args.includes('--update')) writeFileSync(join(here, name + '.roslyn.txt'), expected);
  const result = compileToReferenceAssembly(source, { name: assemblyName });
  if (!result.assembly) throw new Error(`${sample}: ${result.diagnostics.map(d => d.code + ' ' + d.message).join('; ')}`);
  const emitted = join(library, 'sharpforge');
  mkdirSync(emitted, { recursive: true });
  writeFileSync(join(emitted, assemblyName + '.dll'), result.assembly);
  const actual = dump(join(emitted, assemblyName + '.dll')).split('\n'),
    pendingFile = join(here, name + '.pending.txt'),
    pending = new Set(existsSync(pendingFile) ? readFileSync(pendingFile, 'utf8').split('\n').filter(Boolean) : []);
  const wanted = expected.split('\n').filter(line => !pending.has(line));
  const missing = wanted.filter(line => !actual.includes(line)),
    unexpected = actual.filter(line => !wanted.includes(line));
  const sameOrder = !missing.length && !unexpected.length && wanted.every((line, index) => line === actual[index]);
  console.log(`${sample}: ${wanted.length} lines agree with Roslyn${pending.size ? `, ${pending.size} pending` : ''}${sameOrder ? '' : ' - DIFFERENCES'}`);
  for (const line of missing) console.log('  missing:    ' + line);
  for (const line of unexpected) console.log('  unexpected: ' + line);
  if (!sameOrder) {
    failed = true;
    // The same lines in another order or number: show where the dumps part.
    const first = wanted.findIndex((line, index) => line !== actual[index]);
    if (!missing.length && !unexpected.length) console.log(`  line ${first + 1}: Roslyn '${wanted[first]}', SharpForge '${actual[first] ?? ''}'`);
  }
}
process.exitCode = failed ? 1 : 0;
