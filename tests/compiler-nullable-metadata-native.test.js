import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { dotnetHost, sdkVersion } from '../packages/compiler/test/differential/tools/dotnet-axis.mjs';

const fixtures = dirname(fileURLToPath(new URL('./fixtures/nullable-metadata/NullableMetadata.cs', import.meta.url)));
const pack = loadReferencePack();

test('A02-T29 emitted annotations match Roslyn under real .NET NullabilityInfoContext', {
  skip: pack ? false : 'no .NET reference pack installed',
}, context => {
  const dotnet = dotnetHost(), sdk = sdkVersion(dotnet);
  if (!sdk) return context.skip('no .NET SDK host installed');
  const root = process.env.DOTNET_ROOT ?? dirname(dotnet);
  const compiler = join(root, 'sdk', sdk, 'Roslyn', 'bincore', 'csc.dll');
  if (!existsSync(compiler)) return context.skip('no Roslyn compiler found beside the .NET host');
  const scratch = mkdtempSync(join(tmpdir(), 'sharpforge-nullable-native-'));
  try {
    const inspector = join(scratch, 'Inspector.dll');
    execFileSync(dotnet, [compiler, '-nologo', '-noconfig', '-nostdlib', '-target:exe', '-out:' + inspector,
      ...pack.pack.files.map(path => '-reference:' + path), join(fixtures, 'InspectNullability.cs')],
    { encoding: 'utf8', timeout: 30_000 });
    const version = sdk.split('.').slice(0, 2).join('.');
    writeFileSync(join(scratch, 'Inspector.runtimeconfig.json'), JSON.stringify({ runtimeOptions: {
      tfm: 'net' + version, framework: { name: 'Microsoft.NETCore.App', version: version + '.0' },
    } }));
    const source = readFileSync(join(fixtures, 'NullableMetadata.cs'), 'utf8');
    const result = compileToAssembly(source, { name: 'NullableMetadata', outputKind: 'library', allowUnsafe: true, references: pack.references });
    assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
    assert.ok(result.assembly);
    mkdirSync(join(scratch, 'actual'));
    const actualPath = join(scratch, 'actual', 'NullableMetadata.dll');
    writeFileSync(actualPath, result.assembly);
    const inspect = path => execFileSync(dotnet, [inspector, path], { encoding: 'utf8', timeout: 30_000 }).replace(/\r\n/g, '\n');
    const expected = inspect(join(fixtures, 'NullableMetadata.dll'));
    const actual = inspect(actualPath);
    assert.ok(expected.includes('Nullable/Nullable'));
    assert.ok(expected.includes('NotNull/NotNull'));
    assert.ok(expected.includes('Unknown/Unknown'));
    assert.equal(actual, expected);
    const diagnostics = (library, name) => {
      const compilation = spawnSync(dotnet, [compiler, '-nologo', '-noconfig', '-nostdlib', '-target:library',
        '-out:' + join(scratch, name + '.dll'), ...pack.pack.files.map(path => '-reference:' + path),
        '-reference:' + library, join(fixtures, 'ConstraintConsumer.cs')], { encoding: 'utf8', timeout: 30_000 });
      assert.equal(compilation.status, 0, compilation.stdout + compilation.stderr);
      return [...compilation.stdout.matchAll(/warning (CS\d+): ([^\r\n]+)/g)].map(match => [match[1], match[2]]);
    };
    const expectedWarnings = diagnostics(join(fixtures, 'NullableMetadata.dll'), 'ExpectedConsumer');
    assert.ok(expectedWarnings.some(([code]) => code === 'CS8714'));
    assert.ok(expectedWarnings.some(([code]) => code === 'CS8634'));
    assert.ok(expectedWarnings.some(([code]) => code === 'CS8631'));
    assert.deepEqual(diagnostics(actualPath, 'ActualConsumer'), expectedWarnings);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
