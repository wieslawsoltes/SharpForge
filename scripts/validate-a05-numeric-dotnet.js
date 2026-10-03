/** Compare the complete A05 B01/B02 numeric table with the pinned .NET 10 JIT.
 * Requires a .NET 10 SDK.
 */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, writeFile, copyFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRuntimeConfig} from '../packages/cil/src/index.js';
import {CilVirtualMachine} from '../packages/runtime/src/index.js';
import {numericConversionCases, numericConversionFixture, numericConversionOutput} from '../tests/a05-numeric-fixtures.js';

const runFile = promisify(execFile), dotnet = process.env.DOTNET_PATH ?? 'dotnet';
const options = {encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024, env: {...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1'}};
const probe = await runFile(dotnet, ['--list-runtimes'], options);
const version = [...probe.stdout.matchAll(/^Microsoft\.NETCore\.App (10\.\d+\.\d+) /gm)].map(match => match[1]).at(-1);
assert(version, 'The .NET 10 runtime and SDK are required for this pinned conversion policy; other native versions are unsupported by this differential fixture.');
const directory = await mkdtemp(join(tmpdir(), 'sharpforge-a05-numeric-'));
const compare = (bytes, expected, label) => {
  const result = new CilVirtualMachine(new Uint8Array(bytes)).run();
  assert.equal(result.state, 'terminated', `${label}: ${result.fault?.stack}`);
  assert.equal(result.output, expected, label + ' direct CIL output');
};
try {
  const bytes = numericConversionFixture(), path = join(directory, 'A05NumericConversions.dll');
  await writeFile(path, bytes);
  await writeFile(join(directory, 'A05NumericConversions.runtimeconfig.json'), JSON.stringify(createRuntimeConfig({version, rollForward: 'LatestPatch'})));
  const native = await runFile(dotnet, [path], options);
  assert.equal(native.stdout.replaceAll('\r\n', '\n'), numericConversionOutput, '.NET 10 conversion table');
  compare(bytes, numericConversionOutput, 'Independent conversion fixture');

  // Roslyn compiles the exact C# uint-widening reproducer independently of the
  // SharpForge emitter; execute that very same DLL in .NET and the CIL engine.
  for (const file of ['Program.cs', 'NumericConversions.csproj']) await copyFile(new URL('../tests/fixtures/a05/numeric-conversions/' + file, import.meta.url), join(directory, file));
  await runFile(dotnet, ['build', join(directory, 'NumericConversions.csproj'), '-c', 'Release', '--nologo', '-p:RestoreIgnoreFailedSources=true'], options);
  const compiledPath = join(directory, 'bin', 'Release', 'net10.0', 'A05UnsignedWidening.dll');
  const compiled = await runFile(dotnet, [compiledPath], options);
  const expected = '4294967295\n4294967295\n4294967295\n4294967295\n2147483648\n2147483648\n-1\n';
  assert.equal(compiled.stdout.replaceAll('\r\n', '\n'), expected, '.NET uint widening');
  compare(await readFile(compiledPath), expected, 'Roslyn uint widening fixture');
  console.log(JSON.stringify({runtime: version, platform: process.platform, architecture: process.arch, conversionCases: numericConversionCases.length, roslynWideningCases: 7, passed: true}));
} finally {
  await rm(directory, {recursive: true, force: true});
}
