import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Workspace} from '@sharpforge/workspace';
import {emitAssemblyDetailed, loadAssembly, readPE, Reader, decodeCoded} from '@sharpforge/cil';

function library() {
  const workspace = new Workspace({compilationOptions: {outputKind: 'library', name: 'MetadataFixture'}});
  workspace.update('Library.cs', 'public class Visible { public static int Value() { return 42; } }', 1);
  const result = workspace.compile();
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result.image;
}

const attributes = [
  {type: 'System.Reflection.AssemblyVersionAttribute', value: '1.2.3.4'},
  {type: 'System.Reflection.AssemblyCompanyAttribute', value: 'Zażółć — company'},
  {type: 'System.Runtime.CompilerServices.InternalsVisibleToAttribute', value: 'Friend'},
];
const resource = {manifestName: 'MetadataFixture.Data.bin', bytes: Uint8Array.of(0, 1, 127, 128, 255)};

function readAttributes(metadata) {
  return metadata.rows[12].map(row => {
    const method = metadata.row(decodeCoded('CustomAttributeType', row[1]));
    const type = metadata.typeName(decodeCoded('MemberRefParent', method[0]));
    const reader = new Reader(metadata.blob(row[2]));
    assert.equal(reader.u16(), 1);
    const value = new TextDecoder().decode(reader.take(reader.compressed()));
    assert.equal(reader.u16(), 0);
    assert.equal(reader.position, reader.end);
    return {type, value};
  });
}

test('project emission writes assembly identity, string attributes, visibility and exact CLI resource bytes', () => {
  const image = library();
  const options = {assemblyAttributes: attributes, resources: [resource],
    typeDefinitions: {Visible: {name: 'Visible', namespace: 'Fixture', access: 'internal'}}};
  const first = emitAssemblyDetailed(image, options).bytes;
  const second = emitAssemblyDetailed(image, options).bytes;
  assert.deepEqual(first, second, 'metadata and resources preserve deterministic emission');
  const pe = readPE(first);
  assert.deepEqual(pe.metadata.rows[32][0].slice(1, 5), [1, 2, 3, 4]);
  assert.deepEqual(readAttributes(pe.metadata), attributes.slice(1));
  const type = pe.metadata.rows[2].find(row => pe.metadata.string(row[1]) === 'Visible');
  assert.equal(type[0] & 7, 0, 'an internal source type remains assembly-private in emitted metadata');
  assert.equal(pe.metadata.string(type[2]), 'Fixture');
  const row = pe.metadata.rows[40][0];
  assert.equal(pe.metadata.string(row[2]), resource.manifestName);
  const reader = new Reader(first, pe.offsetOf(pe.resources.rva + row[0], resource.bytes.length + 4));
  assert.equal(reader.u32(), resource.bytes.length);
  assert.deepEqual(reader.take(resource.bytes.length), resource.bytes);
  const decoded = loadAssembly(first);
  assert.equal(decoded.types[0].name, 'Fixture.Visible');
  assert.equal(decoded.outputKind, 'library');
  const corrupted = first.slice();
  corrupted[pe.offsetOf(pe.resources.rva + row[0] + 4)] ^= 1;
  assert.throws(() => loadAssembly(corrupted), /canonical/, 'resource changes remain subject to complete byte verification');
});

test('project metadata rejects duplicate, unsupported, nondeterministic and oversized inputs', () => {
  const image = library();
  assert.throws(() => emitAssemblyDetailed(image, {assemblyAttributes: [attributes[1], attributes[1]]}), /Duplicate/);
  assert.throws(() => emitAssemblyDetailed(image, {assemblyAttributes: [{type: 'Custom.ExecuteAttribute', value: 'x'}]}), /Unsupported/);
  for (const value of ['1.*', '65535.0', '1.2.3.4.5', '-1.0']) {
    assert.throws(() => emitAssemblyDetailed(image, {assemblyAttributes: [{type: attributes[0].type, value}]}), /AssemblyVersion/);
  }
  assert.throws(() => emitAssemblyDetailed(image, {resources: [resource, resource]}), /duplicate resource/i);
  assert.throws(() => emitAssemblyDetailed(image, {resources: [{...resource, bytes: 'not bytes'}]}), /requires bytes/);
  assert.throws(() => emitAssemblyDetailed(image, {assemblyCulture: '../outside'}), /culture/i);
  assert.throws(() => emitAssemblyDetailed(image, {typeDefinitions: {Visible: {name: '../Visible', namespace: '', access: 'public'}}}),
    /type definition/);
});

test('satellite resource assemblies carry an explicit culture in Assembly metadata', () => {
  const bytes = emitAssemblyDetailed(library(), {name: 'MetadataFixture.resources', assemblyCulture: 'fr-CA',
    assemblyAttributes: attributes.slice(0, 1), resources: [resource]}).bytes;
  const pe = readPE(bytes);
  assert.equal(pe.metadata.string(pe.metadata.rows[32][0][8]), 'fr-CA');
  assert.equal(pe.metadata.string(pe.metadata.rows[32][0][7]), 'MetadataFixture.resources');
  assert.equal(loadAssembly(bytes).name, 'MetadataFixture.resources');
});

test('the installed CLR reads project attributes and resources from the emitted PE', {
  skip: !process.env.SF_NATIVE_DOTNET && 'Set SF_NATIVE_DOTNET to include the real CLR metadata qualification',
}, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-project-metadata-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const assembly = join(directory, 'MetadataFixture.dll');
  await writeFile(assembly, emitAssemblyDetailed(library(), {assemblyAttributes: attributes, resources: [resource]}).bytes);
  await writeFile(join(directory, 'Probe.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
    + '<TargetFramework>net10.0</TargetFramework><OutputType>Exe</OutputType></PropertyGroup></Project>');
  await writeFile(join(directory, 'Program.cs'), `using System;
using System.IO;
using System.Reflection;
using System.Text.Json;
class Probe {
  static void Main(string[] args) {
    var assembly = Assembly.LoadFile(args[0]);
    using var resource = assembly.GetManifestResourceStream("MetadataFixture.Data.bin");
    using var contents = new MemoryStream();
    resource.CopyTo(contents);
    Console.WriteLine("RESULT:" + JsonSerializer.Serialize(new {
      version = assembly.GetName().Version.ToString(),
      company = assembly.GetCustomAttribute<AssemblyCompanyAttribute>().Company,
      bytes = Convert.ToHexString(contents.ToArray())
    }));
  }
}`);
  const result = spawnSync(process.env.SF_NATIVE_DOTNET, ['run', '--project', join(directory, 'Probe.csproj'),
    '--no-launch-profile', '--', assembly], {encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('RESULT:'));
  assert.ok(line, result.stdout);
  assert.deepEqual(JSON.parse(line.slice(7)), {version: '1.2.3.4', company: attributes[1].value, bytes: '00017F80FF'});
});
