import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {loadReferencePack} from '@sharpforge/compiler/node';
import {dotnetHost, sdkVersion} from '../../packages/compiler/test/differential/tools/dotnet-axis.mjs';

export const asyncNativeTimeout = 30_000;

/** Select a compiler from the host's actual SDK inventory, including a host invoked through PATH. */
export function selectAsyncToolchain({sdk, inventory, framework = null}) {
  if (!sdk) return {available: false, reason: 'no .NET SDK host is available'};
  const version = /^(\d+)\.(\d+)\.\d+(?:[-+].*)?$/.exec(sdk);
  if (!version) throw new Error('Invalid selected .NET SDK version: ' + sdk);
  if (Number(version[1]) < 8) return {available: false, reason: 'C# 12 async fixtures require SDK 8 or newer; selected ' + sdk};
  const targetFramework = 'net' + version[1] + '.' + version[2];
  if (framework && framework !== targetFramework) {
    throw new Error('Declared async framework ' + framework + ' does not match selected SDK ' + sdk);
  }
  const locations = inventory.split(/\r?\n/).map(line => /^(\S+) \[(.+)\]$/.exec(line.trim()))
    .filter(match => match?.[1] === sdk).map(match => match[2]);
  if (locations.length !== 1) throw new Error('Selected SDK must have one exact --list-sdks location: ' + sdk);
  return {
    available: true, sdk, framework: targetFramework, languageVersion: '12',
    dotnetRoot: dirname(locations[0]), compiler: join(locations[0], sdk, 'Roslyn', 'bincore', 'csc.dll'),
    runtimeConfig: {runtimeOptions: {tfm: targetFramework,
      framework: {name: 'Microsoft.NETCore.App', version: version[1] + '.' + version[2] + '.0'}}}
  };
}

/** Unavailable native prerequisites remain explicit; inconsistent declared axes fail rather than selecting another SDK. */
export function loadAsyncToolchain() {
  const dotnet = dotnetHost(), sdk = sdkVersion(dotnet);
  if (!sdk) return {available: false, reason: 'no .NET SDK is available through ' + dotnet};
  const listed = spawnSync(dotnet, ['--list-sdks'], {encoding: 'utf8', timeout: asyncNativeTimeout});
  if (listed.error || listed.status !== 0) throw new Error('Cannot inspect selected .NET SDK: ' + (listed.error?.message ?? listed.stderr));
  const selected = selectAsyncToolchain({sdk, inventory: listed.stdout, framework: process.env.DOTNET_TARGET_FRAMEWORK});
  if (!selected.available) return selected;
  if (!existsSync(selected.compiler)) return {available: false, reason: 'selected Roslyn compiler is unavailable: ' + selected.compiler};
  const pack = loadReferencePack({dotnetRoot: selected.dotnetRoot, targetFramework: selected.framework});
  if (!pack) return {available: false, reason: 'no ' + selected.framework + ' reference pack in selected SDK root ' + selected.dotnetRoot};
  const invocation = {
    dotnet, sdk, compiler: selected.compiler, framework: selected.framework, languageVersion: selected.languageVersion,
    referencePack: pack.pack.version, referenceDirectory: pack.pack.directory, referenceFiles: pack.pack.files.length,
    runtimeConfig: selected.runtimeConfig, runtimeScope: 'requested runtime configuration; executed runtime patch is not independently probed',
    cwd: process.cwd(), timeoutMs: asyncNativeTimeout,
    environment: Object.fromEntries(['DOTNET', 'DOTNET_ROOT', 'DOTNET_TARGET_FRAMEWORK', 'NODE_OPTIONS',
      'SHARPFORGE_MAX_PARALLEL_RUNS', 'SHARPFORGE_TEST_CONCURRENCY', 'SHARPFORGE_MAX_OLD_SPACE_MB']
      .map(name => [name, process.env[name] ?? null]))
  };
  return {...selected, dotnet, pack, invocation};
}
