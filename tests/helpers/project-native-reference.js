import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

function invoke(dotnet, args) {
  const result = spawnSync(dotnet, args, { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}

/** Resolve only installed SDK/runtime/reference packs; native oracles never restore from the network. */
export function resolveNativeReference(dotnet, sdk = invoke(dotnet, ['--version'])) {
  const sdkRow = invoke(dotnet, ['--list-sdks']).split(/\r?\n/).find(row => row.startsWith(sdk + ' ['));
  assert(sdkRow, 'Selected SDK must be present in dotnet --list-sdks');
  const sdkHome = sdkRow.slice(sdkRow.indexOf('[') + 1, sdkRow.lastIndexOf(']'));
  const runtimeRow = invoke(dotnet, ['--list-runtimes']).split(/\r?\n/)
    .filter(row => row.startsWith('Microsoft.NETCore.App ' + sdk.split('.')[0] + '.')).at(-1);
  assert(runtimeRow, 'Native oracle requires the selected SDK major runtime');
  const runtime = runtimeRow.split(' ')[1];
  const framework = 'net' + runtime.split('.').slice(0, 2).join('.');
  const referenceRoot = join(dirname(sdkHome), 'packs/Microsoft.NETCore.App.Ref');
  const pack = readdirSync(referenceRoot).filter(value => value.startsWith(sdk.split('.')[0] + '.'))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true })).at(-1);
  const referenceDirectory = join(referenceRoot, pack, 'ref', framework);
  const references = readdirSync(referenceDirectory).filter(name => name.endsWith('.dll'))
    .map(name => join(referenceDirectory, name));
  return { dotnet, sdk, runtime, framework, sdkDirectory: join(sdkHome, sdk), references,
    compiler: join(sdkHome, sdk, 'Roslyn/bincore/csc.dll') };
}

/** Compile an offline CLR JSON oracle with optional SDK-owned references copied beside the output. */
export function compileNativeJsonProgram(toolchain, directory, source, { references = [], name = 'ReferenceOracle' } = {}) {
  const program = join(directory, name + '.cs');
  const assembly = join(directory, name + '.dll');
  writeFileSync(program, source);
  const compilerReferences = [...toolchain.references, ...references].map(path => '-reference:' + path);
  invoke(toolchain.dotnet, [toolchain.compiler, '-nologo', '-target:exe', '-out:' + assembly, ...compilerReferences, program]);
  for (const path of references) copyFileSync(path, join(directory, basename(path)));
  writeFileSync(join(directory, name + '.runtimeconfig.json'), JSON.stringify({ runtimeOptions: {
    tfm: toolchain.framework, framework: { name: 'Microsoft.NETCore.App', version: toolchain.runtime },
  } }));
  return args => JSON.parse(invoke(toolchain.dotnet, [assembly, ...args]));
}
