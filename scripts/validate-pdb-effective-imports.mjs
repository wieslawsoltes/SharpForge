import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSymbols } from '@sharpforge/symbols';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dotnet = process.env.DOTNET_PATH ?? 'dotnet';
const temporary = await mkdtemp(join(tmpdir(), 'sharpforge-effective-imports-'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (args) => {
  const result = spawnSync(dotnet, args, {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
  });
  if (result.error || result.status !== 0) throw Error(result.error?.message ?? result.stdout + result.stderr);
  return result.stdout.trim();
};

try {
  const project = join(temporary, 'EffectiveImports');
  await cp(join(root, 'packages/symbols/interop/EffectiveImports'), project, { recursive: true });
  const source = (await readFile(join(project, 'Program.cs'), 'utf8')).replaceAll('\r\n', '\n');
  await writeFile(join(project, 'Program.cs'), source);
  const output = join(temporary, 'output');
  const sdk = run(['--version']);
  const sdkLine = run(['--list-sdks'])
    .split(/\r?\n/)
    .find((line) => line.startsWith(sdk + ' ['));
  const sdkDirectory = sdkLine?.match(/\[(.*)\]$/)?.[1];
  if (!sdkDirectory) throw Error('Could not locate the selected native compiler');
  const compiler = join(sdkDirectory, sdk, 'Roslyn/bincore/csc.dll');
  const compilerVersion = run([compiler, '-version']);
  const compilerSha256 = digest(await readFile(compiler));
  run([
    'build',
    join(project, 'EffectiveImports.csproj'),
    '-o',
    output,
    '--nologo',
    '--ignore-failed-sources',
    '-m:1',
    '-p:UseSharedCompilation=false',
    '-nodeReuse:false',
    '-p:PathMap=' + temporary + '=/src/effective-imports',
  ]);
  const assemblyPath = join(output, 'EffectiveImports.dll');
  const assembly = await readFile(assemblyPath);
  const reference = JSON.parse(run([assemblyPath]));
  const pdb = await readFile(join(output, 'EffectiveImports.pdb'));
  const symbols = loadSymbols(assembly, pdb);
  const imports = symbols.effectiveImports(reference.importScope);
  assert.equal(symbols.bound, true);
  assert.equal(reference.result, 7);
  assert.deepEqual(
    imports.map(({ kind, scopeId, alias = null, namespace = null, type = null, typeName = null }) => ({
      kind,
      scopeId,
      alias,
      namespace,
      type,
      typeName,
    })),
    reference.entries,
  );
  assert.deepEqual(
    imports.filter((entry) => entry.namespace).map((entry) => entry.namespace),
    ['System', 'System.Text'],
  );
  assert(imports.some((entry) => entry.alias === 'Alias' && entry.typeName === 'System.Text.StringBuilder'));
  assert(imports.some((entry) => entry.kind === 3 && entry.typeName === 'System.Math'));
  const record = {
    schemaVersion: 1,
    reference: {
      sdk,
      compilerVersion,
      compilerSha256,
      runtime: reference.runtime,
      mode: 'Debug',
      sourceSha256: digest(source),
      assemblySha256: digest(assembly),
      pdbSha256: digest(pdb),
    },
    native: reference,
  };
  const capture = process.argv.indexOf('--capture');
  if (capture >= 0) {
    const directory = resolve(process.argv[capture + 1]);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'EffectiveImports.dll'), assembly);
    await writeFile(join(directory, 'EffectiveImports.pdb'), pdb);
    await writeFile(join(directory, 'reference.json'), JSON.stringify(record, null, 2) + '\n');
  }
  console.log(
    JSON.stringify({ passed: true, imports: reference.entries.length, reference: record.reference }, null, 2),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
