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
const temporary = await mkdtemp(join(tmpdir(), 'sharpforge-closure-map-'));
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
  const project = join(temporary, 'ClosureMap');
  await cp(join(root, 'packages/symbols/interop/ClosureMap'), project, { recursive: true });
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
    join(project, 'ClosureMap.csproj'),
    '-o',
    output,
    '--nologo',
    '--ignore-failed-sources',
    '-m:1',
    '-p:UseSharedCompilation=false',
    '-nodeReuse:false',
    '-p:PathMap=' + temporary + '=/src/closure-map',
  ]);
  const assemblyPath = join(output, 'ClosureMap.dll');
  const assembly = await readFile(assemblyPath);
  const reference = JSON.parse(run([assemblyPath]));
  const pdb = await readFile(join(output, 'ClosureMap.pdb'));
  const symbols = loadSymbols(assembly, pdb);
  assert.equal(reference.maps.length, 2);
  assert.equal(reference.types.length, 2);
  let mappedMethods = 0;
  for (const type of reference.types) {
    const native = reference.maps.find((map) => map.containingType === type.enclosingType);
    const names = native.typeName === 'Fixture' ? ['captured'] : ['other'];
    const methods = type.methods.filter((method) => method.name.includes('>b__'));
    assert.equal(methods.length, 2);
    for (let ordinal = 0; ordinal < methods.length; ordinal++) {
      const method = methods.find((method) => method.name === `<Nested>b__${ordinal}`);
      assert(method);
      const result = symbols.closureInfo(method.methodToken);
      assert.equal(result.available, true);
      assert.equal(result.containingMethod, native.containingMethod);
      assert.equal(result.methodOrdinal, native.methodOrdinal);
      assert.equal(result.lambdaOrdinal, ordinal);
      assert.equal(result.closureType, type.typeToken);
      assert.equal(result.syntaxOffset, native.lambdas[ordinal].syntaxOffset);
      assert.equal(result.closureOrdinal, native.lambdas[ordinal].closureOrdinal);
      assert.equal(result.closureSyntaxOffset, native.closures[result.closureOrdinal].syntaxOffset);
      assert.deepEqual(
        result.captures.map((field) => field.name),
        names,
      );
      for (const field of result.captures)
        assert(
          type.fields.some(
            (nativeField) => nativeField.fieldToken === field.fieldToken && nativeField.name === field.name,
          ),
        );
      mappedMethods++;
    }
  }
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
    await writeFile(join(directory, 'ClosureMap.dll'), assembly);
    await writeFile(join(directory, 'ClosureMap.pdb'), pdb);
    await writeFile(join(directory, 'reference.json'), JSON.stringify(record, null, 2) + '\n');
  }
  console.log(JSON.stringify({ passed: true, mappedMethods, reference: record.reference }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
