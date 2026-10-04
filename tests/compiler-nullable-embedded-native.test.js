import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToAssembly } from '@sharpforge/compiler';
import { dotnetHost, sdkVersion } from '../packages/compiler/test/differential/tools/dotnet-axis.mjs';
import { legacyNullableReferences } from './fixtures/nullable-metadata/legacy-references.mjs';

const here = dirname(fileURLToPath(new URL('./fixtures/nullable-metadata/NullableMetadata.cs', import.meta.url)));
const legacy = legacyNullableReferences();

test('A02-T05.3 local nullable constructors, reflection annotations and native consumers match Roslyn', {
  skip: legacy ? false : 'no .NET reference pack installed',
}, context => {
  const dotnet = dotnetHost(), sdk = sdkVersion(dotnet);
  if (!sdk) return context.skip('no .NET SDK host installed');
  const compiler = join(process.env.DOTNET_ROOT ?? dirname(dotnet), 'sdk', sdk, 'Roslyn', 'bincore', 'csc.dll');
  if (!existsSync(compiler)) return context.skip('no Roslyn compiler found beside the .NET host');
  const scratch = mkdtempSync(join(tmpdir(), 'sharpforge-embedded-nullable-'));
  try {
    const version = sdk.split('.').slice(0, 2).join('.');
    const createInspector = (name, source) => {
      const output = join(scratch, name + '.dll');
      execFileSync(dotnet, [compiler, '-nologo', '-noconfig', '-nostdlib', '-target:exe', '-out:' + output,
        ...legacy.pack.files.map(path => '-reference:' + path), join(here, source)], { encoding: 'utf8', timeout: 30_000 });
      writeFileSync(join(scratch, name + '.runtimeconfig.json'), JSON.stringify({ runtimeOptions: {
        tfm: 'net' + version, framework: { name: 'Microsoft.NETCore.App', version: version + '.0' },
      } }));
      return library => execFileSync(dotnet, [output, library], { encoding: 'utf8', timeout: 30_000 }).replace(/\r\n/g, '\n');
    };
    const inspectDefinitions = createInspector('InspectEmbedded', 'InspectEmbedded.cs');
    const inspectNullability = createInspector('InspectNullability', 'InspectNullability.cs');
    const result = compileToAssembly(readFileSync(join(here, 'NullableMetadata.cs'), 'utf8'), {
      name: 'LegacyNullableMetadata', outputKind: 'library', allowUnsafe: true, references: legacy.references,
    });
    assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
    assert.ok(result.assembly);
    const actual = join(scratch, 'LegacyNullableMetadata.dll'), expected = join(here, 'LegacyNullableMetadata.dll');
    writeFileSync(actual, result.assembly);
    const expectedDefinitions = inspectDefinitions(expected);
    assert.ok(expectedDefinitions.includes('scalar=2'));
    assert.ok(expectedDefinitions.includes('array=1,2,0:same=True'));
    assert.ok(expectedDefinitions.includes('null=True'));
    assert.ok(expectedDefinitions.includes('context=2'));
    assert.equal(inspectDefinitions(actual), expectedDefinitions);
    assert.equal(inspectNullability(actual), inspectNullability(expected));
    const warnings = (library, name) => {
      const built = spawnSync(dotnet, [compiler, '-nologo', '-noconfig', '-nostdlib', '-target:library',
        '-out:' + join(scratch, name + '.dll'), ...legacy.pack.files.map(path => '-reference:' + path),
        '-reference:' + library, join(here, 'ConstraintConsumer.cs')], { encoding: 'utf8', timeout: 30_000 });
      assert.equal(built.status, 0, built.stdout + built.stderr);
      return [...built.stdout.matchAll(/warning (CS\d+): ([^\r\n]+)/g)].map(match => [match[1], match[2]]);
    };
    const expectedWarnings = warnings(expected, 'ExpectedConsumer');
    assert.ok(expectedWarnings.some(([code]) => code === 'CS8714'));
    assert.ok(expectedWarnings.some(([code]) => code === 'CS8634'));
    assert.ok(expectedWarnings.some(([code]) => code === 'CS8631'));
    assert.deepEqual(warnings(actual, 'ActualConsumer'), expectedWarnings);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
