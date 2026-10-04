import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { loadSymbols } from '@sharpforge/symbols';
import { dotnetHost, sdkVersion } from '../packages/compiler/test/differential/tools/dotnet-axis.mjs';

const dotnet = dotnetHost();
const pack = loadReferencePack();
const sdk = pack ? sdkVersion(dotnet) : null;
const skip = !pack ? 'no .NET reference pack is installed' : !sdk ? 'no .NET SDK is installed' : false;
const source = `using System;
using System.Threading.Tasks;
using System.Collections.Generic;
class P {
  static async Task<int> Value() { int value = 40; await Task.Yield(); return value + 2; }
  static IEnumerable<int> Items() { yield return 1; yield return 2; }
  static async Task Main() {
    Console.WriteLine(await Value());
    foreach (var item in Items()) Console.WriteLine(item);
    try {
#line 123 "view.cs"
      throw new InvalidOperationException("failure");
#line default
    } catch (Exception error) { Console.WriteLine(error.StackTrace.Contains("view.cs:line 123")); }
  }
}`;

function run(args, options = {}) {
  return execFileSync(dotnet, args, {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
    ...options,
  }).replace(/\r\n/g, '\n').trim();
}

function buildReader(scratch) {
  const project = join(scratch, 'reader');
  mkdirSync(project);
  for (const name of ['Program.cs', 'SrmReader.csproj']) {
    const original = fileURLToPath(new URL('../packages/symbols/interop/SrmReader/' + name, import.meta.url));
    copyFileSync(original, join(project, name));
  }
  run(['build', join(project, 'SrmReader.csproj'), '--nologo', '-v:q', '-o', join(project, 'bin')]);
  return join(project, 'bin', 'SrmReader.dll');
}

function verifyNative(native, symbols) {
  assert.equal(native.id.toLowerCase(), symbols.idHex);
  assert.equal(native.entryPoint, symbols.entryPoint);
  assert.deepEqual(native.documents.map(document => ({
    name: document.name, hash: document.hash.toLowerCase(), language: document.language,
    algorithm: document.hashAlgorithm === '00000000-0000-0000-0000-000000000000' ? null : document.hashAlgorithm,
  })), symbols.documents.map(document => ({
    name: document.name, hash: Buffer.from(document.hash).toString('hex'), language: document.language, algorithm: document.hashAlgorithm,
  })));
  assert.deepEqual(native.methods, symbols.methods.map(method => ({
    token: method.token,
    kickoff: symbols.stateMachines.find(machine => machine.moveNext === method.token)?.kickoff ?? 0x06000000,
    points: method.points.map(point => ({ Offset: point.offset, document: point.document, StartLine: point.startLine,
      StartColumn: point.startColumn, EndLine: point.endLine, EndColumn: point.endColumn, IsHidden: point.hidden })),
  })));
  assert.deepEqual(native.scopes, symbols.scopes.map(scope => ({
    method: scope.methodToken, StartOffset: scope.start, Length: scope.end - scope.start, importScope: scope.importScope,
    variables: scope.variables.map(variable => variable.id), constants: scope.constants.map(constant => constant.id),
  })));
  assert.deepEqual(native.custom.map(record => ({ ...record, bytes: record.bytes.toLowerCase() })),
    symbols.custom.map(record => ({ parent: record.parent, kind: record.kind, bytes: Buffer.from(record.bytes).toString('hex') })));
}

test('direct CIL PDBs agree with independent SRM and sidecar/embedded .NET stack traces agree with Roslyn', { skip }, context => {
  const scratch = mkdtempSync(join(tmpdir(), 'sharpforge-cil-pdb-'));
  try {
    const reader = buildReader(scratch);
    const reference = join(scratch, 'reference');
    mkdirSync(reference);
    writeFileSync(join(reference, 'Program.cs'), source);
    writeFileSync(join(reference, 'Reference.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>
      <OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><DebugType>portable</DebugType>
      <Optimize>false</Optimize><LangVersion>14</LangVersion></PropertyGroup></Project>`);
    run(['build', join(reference, 'Reference.csproj'), '--nologo', '-v:q', '-o', join(reference, 'bin')]);
    const expected = run([join(reference, 'bin', 'Reference.dll')]);
    assert.equal(expected, '42\n1\n2\nTrue');
    const nativeReference = JSON.parse(run([reader, 'inspect', join(reference, 'bin', 'Reference.pdb'), join(reference, 'bin', 'Reference.dll')]));
    assert.ok(nativeReference.documents.some(document => document.name === 'view.cs'));
    for (const embeddedPdb of [false, true]) {
      const directory = join(scratch, embeddedPdb ? 'embedded' : 'sidecar');
      mkdirSync(directory);
      const emitted = compileToAssembly([{ uri: 'Program.cs', text: source }], {
        name: 'Fixture', references: pack.references, embeddedPdb, langVersion: '14',
      });
      assert.equal(emitted.success, true, emitted.diagnostics.map(diagnostic => diagnostic.message).join('\n'));
      assert.ok(emitted.pdb instanceof Uint8Array);
      const assembly = join(directory, 'Fixture.dll');
      const pdb = join(directory, 'Fixture.pdb');
      writeFileSync(assembly, emitted.assembly);
      writeFileSync(pdb, emitted.pdb);
      const version = sdk.split('.').slice(0, 2).join('.');
      writeFileSync(join(directory, 'Fixture.runtimeconfig.json'), JSON.stringify({
        runtimeOptions: { tfm: 'net' + version, framework: { name: 'Microsoft.NETCore.App', version: version + '.0' } },
      }));
      const native = JSON.parse(run([reader, 'inspect', pdb, assembly]));
      verifyNative(native, loadSymbols(emitted.assembly, emitted.pdb));
      assert.equal(native.directories.some(directory => directory.kind === 17), embeddedPdb);
      if (embeddedPdb) rmSync(pdb);
      assert.equal(run([assembly]), expected, embeddedPdb ? 'embedded symbols' : 'sidecar symbols');
    }
    context.diagnostic(`SRM and Roslyn on .NET SDK ${sdk}; reference pack ${pack.pack.version}; both symbol delivery modes executed`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
