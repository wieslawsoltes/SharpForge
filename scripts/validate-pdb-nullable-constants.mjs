import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSymbols, readPortablePdb } from '@sharpforge/symbols';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dotnet = process.env.DOTNET_PATH ?? 'dotnet';
const temporary = await mkdtemp(join(tmpdir(), 'sharpforge-nullable-constants-'));
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
  const project = join(temporary, 'NullableConstants');
  await cp(join(root, 'packages/symbols/interop/NullableConstants'), project, { recursive: true });
  const sources = {};
  for (const file of ['Program.cs', 'TypeNames.cs']) {
    sources[file] = (await readFile(join(project, file), 'utf8')).replaceAll('\r\n', '\n');
    await writeFile(join(project, file), sources[file]);
  }
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
    join(project, 'NullableConstants.csproj'),
    '-o',
    output,
    '--nologo',
    '--ignore-failed-sources',
    '-m:1',
    '-p:UseSharedCompilation=false',
    '-nodeReuse:false',
    '-p:PathMap=' + temporary + '=/src/nullable-constants',
  ]);
  const generated = join(temporary, 'generated');
  const reference = JSON.parse(run([join(output, 'NullableConstants.dll'), generated]));
  const assembly = await readFile(join(generated, 'NullableDefaults.dll'));
  const pdb = await readFile(join(generated, 'NullableDefaults.pdb'));
  const symbols = loadSymbols(assembly, pdb);
  assert.equal(symbols.bound, true);
  const standalone = readPortablePdb(pdb);
  assert.equal(reference.constants.length, 16);
  for (const native of reference.constants) {
    const result = symbols.constants.find((constant) => constant.name === native.name);
    assert(result);
    assert.equal(Buffer.from(result.signature).toString('hex').toUpperCase(), native.signature);
    assert.match(native.typeSignature, /^System\.Nullable`1</);
    assert.equal(native.boxedDefaultIsNull, true);
    assert.equal(result.type, 'nullable');
    assert.equal(result.decoded, true);
    assert.equal(result.value, null);
    assert.equal(result.defaultValue, true);
    assert.equal(result.typeToken, native.typeToken);
    assert.equal(
      standalone.constants.find((constant) => constant.name === native.name).reason,
      'type-metadata-required',
    );
  }
  const record = {
    schemaVersion: 1,
    reference: {
      sdk,
      compilerVersion,
      compilerSha256,
      runtime: reference.runtime,
      mode: 'SRM-built metadata and CLR boxed defaults',
      sourceSha256: Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, digest(source)])),
      assemblySha256: digest(assembly),
      pdbSha256: digest(pdb),
    },
    native: reference,
  };
  const capture = process.argv.indexOf('--capture');
  if (capture >= 0) {
    const directory = resolve(process.argv[capture + 1]);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'NullableDefaults.dll'), assembly);
    await writeFile(join(directory, 'NullableDefaults.pdb'), pdb);
    await writeFile(join(directory, 'reference.json'), JSON.stringify(record, null, 2) + '\n');
  }
  console.log(
    JSON.stringify({ passed: true, constants: reference.constants.length, reference: record.reference }, null, 2),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
