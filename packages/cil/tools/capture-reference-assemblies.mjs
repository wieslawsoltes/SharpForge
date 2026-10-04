import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToReferenceAssembly } from '@sharpforge/compiler';
import { locateReferencePack } from '@sharpforge/compiler/node';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const dotnetInput = option('--dotnet') ?? process.env.DOTNET;
assert.ok(dotnetInput, 'Provide --dotnet with the path of an installed SDK host');
const dotnet = resolve(dotnetInput);
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
  const common = [csc, '-nologo', '-noconfig', '-nostdlib+', '-warn:0', '-deterministic+', '-langversion:latest', ...references];
  const oracle = join(temporary, 'Oracle.dll');
  run([...common, '-target:exe', '-out:' + oracle, join(fixture, 'Program.cs')]);
  writeJson(join(temporary, 'Oracle.runtimeconfig.json'), {
    runtimeOptions: { tfm: pack.targetFramework, framework: { name: 'Microsoft.NETCore.App', version: pack.version } },
  });
  const source = readFileSync(join(fixture, 'surface.cs'), 'utf8');
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
    run([...common, '-target:library', '-refonly', '-out:' + native, sourcePath]);
    const compiled = compileToReferenceAssembly(text, { name: 'RefSurface', refout: true });
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    writeFileSync(emitted, compiled.assembly);
    const expected = JSON.parse(run([oracle, native]));
    const observed = JSON.parse(run([oracle, emitted]));
    writeJson(join(output, id + '-expected.json'), expected);
    writeJson(join(output, id + '-observed.json'), observed);
    copyFileSync(native, join(output, id + '-roslyn.dll'));
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
    platform: process.platform, architecture: process.arch,
    sourceSha256: hash(source), oracleSha256: hash(readFileSync(join(fixture, 'Program.cs'))), cases };
  writeJson(join(output, 'reference.json'), result);
  console.log(JSON.stringify({ sdk, compiler, runtime: result.runtime, cases: cases.length, output }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
