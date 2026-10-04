import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToReferenceAssembly } from '@sharpforge/compiler';
import { locateReferencePack } from '@sharpforge/compiler/node';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const dotnetInput = option('--dotnet') ?? process.env.DOTNET;
assert.ok(dotnetInput, 'Provide --dotnet with the path of an installed SDK host');
const dotnet = realpathSync(resolve(dotnetInput));
const dotnetRoot = dirname(dotnet);
const output = resolve(option('--output') ?? 'artifacts/a03-reference-assemblies');
const fixture = fileURLToPath(new URL('../../../tests/fixtures/a03-reference-assemblies/', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'sharpforge-refout-'));
const environment = { ...process.env, DOTNET_ROOT: dotnetRoot, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' };
const run = parameters => execFileSync(dotnet, parameters, {
  cwd: temporary, env: environment, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

try {
  mkdirSync(output, { recursive: true });
  const sdk = run(['--version']).trim();
  const csc = join(dotnetRoot, 'sdk', sdk, 'Roslyn', 'bincore', 'csc.dll');
  const pack = locateReferencePack({ dotnetRoot });
  assert.ok(pack, 'Installed .NET reference pack is required');
  const compiler = run([csc, '-version']).trim();
  const references = pack.files.map(path => '-r:' + path);
  const common = [csc, '-nologo', '-noconfig', '-nostdlib+', '-warn:0', '-unsafe+', '-deterministic+', '-langversion:latest', ...references];
  const oracle = join(temporary, 'Oracle.dll');
  const oracleSources = ['Program.cs', 'SignatureNames.cs', 'AttributeTypes.cs'];
  writeJson(join(output, 'capture-inputs.json'), { sdk, compiler, referencePack: pack.version,
    platform: process.platform, architecture: process.arch,
    files: Object.fromEntries([...oracleSources, 'surface.cs', 'consumer.cs', 'observer-enums.cs']
      .map(name => [name, hash(readFileSync(join(fixture, name)))])) });
  run([...common, '-target:exe', '-out:' + oracle, ...oracleSources.map(name => join(fixture, name))]);
  writeJson(join(temporary, 'Oracle.runtimeconfig.json'), {
    runtimeOptions: { tfm: pack.targetFramework, framework: { name: 'Microsoft.NETCore.App', version: pack.version } },
  });
  const enumProbe = join(temporary, 'ObserverEnums.dll');
  run([...common, '-target:library', '-refonly', '-out:' + enumProbe, join(fixture, 'observer-enums.cs')]);
  copyFileSync(enumProbe, join(output, 'observer-enums.dll'));
  const enumObservation = JSON.parse(run([oracle, enumProbe]));
  writeJson(join(output, 'observer-enums.json'), enumObservation);
  const enumAttribute = enumObservation.surface.find(type => type.name === 'EnumObservation.Probe').attributes
    .find(attribute => attribute.name === 'EnumObservation.EnumArgumentsAttribute');
  assert.deepEqual(enumAttribute.arguments.map(argument => Array.isArray(argument.value)
    ? argument.value.map(element => element.value) : argument.value), [255, 4294967296, 0, 4294967296, [255], 'System.Int32']);
  assert.equal(enumAttribute.arguments[4].value[0].type, enumAttribute.arguments[0].type);
  assert.deepEqual(enumAttribute.named.map(argument => [argument.name, argument.value]), [['Choice', 255], ['NullValues', null]]);
  const source = readFileSync(join(fixture, 'surface.cs'), 'utf8');
  const control = compileToReferenceAssembly(source, { name: 'MetadataControl', allowUnsafe: true });
  assert.equal(control.success, true, JSON.stringify(control.diagnostics));
  const controlPath = join(temporary, 'MetadataControl.dll');
  writeFileSync(controlPath, control.assembly);
  copyFileSync(controlPath, join(output, 'metadata-control.dll'));
  const controlObservation = JSON.parse(run([oracle, controlPath]));
  writeJson(join(output, 'metadata-control.json'), controlObservation);
  assert.equal(controlObservation.markerCount, 0);
  assert.equal(controlObservation.loadRejection, 'none', 'Marker-free metadata-only control must load successfully');
  const consumer = join(fixture, 'consumer.cs');
  const cases = [];
  for (const friends of [false, true]) {
    const id = friends ? 'friend' : 'public';
    const text = friends
      ? source.replace('using System;', 'using System;\n[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("Friend")]')
      : source;
    const sourcePath = join(temporary, 'Source.cs');
    const native = join(temporary, id, 'roslyn', 'RefSurface.dll');
    const emitted = join(temporary, id, 'sharpforge', 'RefSurface.dll');
    mkdirSync(dirname(native), { recursive: true });
    mkdirSync(dirname(emitted), { recursive: true });
    writeFileSync(sourcePath, text);
    writeFileSync(join(output, id + '-source.cs'), text);
    run([...common, '-target:library', '-refonly', '-out:' + native, sourcePath]);
    copyFileSync(native, join(output, id + '-roslyn.dll'));
    const compiled = compileToReferenceAssembly(text, { name: 'RefSurface', refout: true, allowUnsafe: true });
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    writeFileSync(emitted, compiled.assembly);
    copyFileSync(emitted, join(output, id + '-sharpforge.dll'));
    const expected = JSON.parse(run([oracle, native]));
    writeJson(join(output, id + '-expected.json'), expected);
    const observed = JSON.parse(run([oracle, emitted]));
    writeJson(join(output, id + '-observed.json'), observed);
    assert.deepEqual(observed, expected, `${id}: native SRM and CLR observations must match Roslyn`);
    assert.equal(observed.markerCount, 1);
    assert.equal(observed.allBodiesThrowNull, true);
    assert.equal(observed.loadRejection, 'BadImageFormatException');
    run([...common, '-target:library', '-r:' + emitted, '-out:' + join(temporary, 'Consumer.dll'), consumer]);
    const friendConsumer = join(temporary, 'Friend.cs');
    writeFileSync(friendConsumer, 'public class FriendUse { public int Read(RefSurface.Contract c) => c.Internal(); }');
    const friendArgs = [...common, '-target:library', '-r:' + emitted, '-out:' + join(temporary, 'Friend.dll'), friendConsumer];
    const attempt = spawnSync(dotnet, friendArgs, {
      cwd: temporary, env: environment, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
    });
    if (attempt.error) throw attempt.error;
    assert.equal(attempt.status === 0, friends, 'csc friend access must follow InternalsVisibleTo');
    if (!friends) assert.match(attempt.stdout + attempt.stderr, /CS1061|CS0122/);
    const referenceName = id + '-roslyn.dll';
    cases.push({ id, sourceSha256: hash(text), referenceFile: referenceName,
      referenceSha256: hash(readFileSync(native)), emittedSha256: hash(compiled.assembly),
      consumerCompiled: true, friendConsumerCompiled: friends, ...expected });
  }
  const result = { schemaVersion: 1, sdk, compiler, runtime: cases[0].runtime, referencePack: pack.version,
    platform: process.platform, architecture: process.arch, metadataControlLoads: true,
    sourceSha256: hash(source), oracleSha256: hash(readFileSync(join(fixture, 'Program.cs'))),
    signatureNamesSha256: hash(readFileSync(join(fixture, 'SignatureNames.cs'))),
    attributeTypesSha256: hash(readFileSync(join(fixture, 'AttributeTypes.cs'))),
    observerEnumsSha256: hash(readFileSync(join(fixture, 'observer-enums.cs'))), cases };
  writeJson(join(output, 'reference.json'), result);
  console.log(JSON.stringify({ sdk, compiler, runtime: result.runtime, cases: cases.length, output }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
