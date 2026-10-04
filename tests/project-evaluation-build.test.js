import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSystem, parseResx, writeResources, readResources, readLaunchSettings, parseLaunchArguments,
  parseConfigurationJson } from '../packages/project-system/src/index.js';
import { evaluate, noErrors } from './helpers/project-evaluation.js';

test('build plan keeps project assemblies, sources, references and internal visibility isolated', () => {
  const result = evaluate(`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><AssemblyName>App</AssemblyName></PropertyGroup>
    <ItemGroup><ProjectReference Include="../Lib/Lib.csproj" PrivateAssets="all"/></ItemGroup></Project>`, {
    'Lib/Lib.csproj': `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><InternalsVisibleTo Include="App"/></ItemGroup></Project>`,
    'Lib/Hidden.cs': 'internal class Hidden {}',
  });
  noErrors(result);
  const plan = result.system.buildPlan('App/App.csproj');
  assert.deepEqual(plan.units.map(unit => unit.project), ['Lib/Lib.csproj', 'App/App.csproj']);
  assert.deepEqual(plan.units[0].sources.map(source => source.uri), ['Lib/Hidden.cs']);
  assert.deepEqual(plan.units[1].sources.map(source => source.uri), ['App/Program.cs']);
  assert.equal(plan.units[1].references[0].output, plan.units[0].output);
  assert.equal(plan.units[1].references[0].internalsVisible, true);
  assert.equal(plan.units[1].references[0].privateAssets, 'all');
  assert.equal(plan.units[0].internalVisibility, 'assembly');
});

test('build plan does not grant internal visibility without an explicit friend assembly', () => {
  const result = evaluate('<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><ProjectReference Include="../Lib/Lib.csproj"/></ItemGroup></Project>', {
    'Lib/Lib.csproj': '<Project Sdk="Microsoft.NET.Sdk"/>', 'Lib/Hidden.cs': 'internal class Hidden {}',
  });
  assert.equal(result.system.buildPlan().units[1].references[0].internalsVisible, false);
});

test('ReferenceOutputAssembly=false retains build order but is excluded from metadata references', () => {
  const result = evaluate('<Project><ItemGroup><ProjectReference Include="../Lib/Lib.csproj" ReferenceOutputAssembly="false"/></ItemGroup></Project>', {
    'Lib/Lib.csproj': '<Project/>',
  });
  noErrors(result);
  assert.deepEqual(result.solution.buildOrder, ['Lib/Lib.csproj', 'App/App.csproj']);
  assert.equal(result.project.projectReferences.length, 0);
  assert.equal(result.system.buildPlan().units[1].references[0].referenceOutputAssembly, false);
});

test('build plans reject project cycles and unavailable sources', () => {
  const cyclic = evaluate('<Project><ItemGroup><ProjectReference Include="App.csproj"/></ItemGroup></Project>');
  assert.throws(() => cyclic.system.buildPlan(), /cycle/);
  const missing = evaluate('<Project><ItemGroup><Compile Include="missing.cs"/></ItemGroup></Project>');
  assert.throws(() => missing.system.buildPlan(), /missing/);
});

test('string and primitive resx values round-trip through the .resources binary reader', () => {
  const resources = parseResx(`<root>
    <data name="Greeting"><value>Zażółć 😀</value></data><data name="Empty"><value></value></data>
    <data name="Count" type="System.Int32, mscorlib"><value>42</value></data>
    <data name="Enabled" type="System.Boolean, mscorlib"><value>true</value></data>
    <data name="Large" type="System.Int64, mscorlib"><value>9223372036854775807</value></data>
    <data name="Fraction" type="System.Double, mscorlib"><value>1.25</value></data>
  </root>`);
  const bytes = writeResources(resources);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0xbeefcace);
  const restored = readResources(bytes).sort((first, second) => first.name.localeCompare(second.name));
  assert.deepEqual(restored, resources.sort((first, second) => first.name.localeCompare(second.name)));
  assert.throws(() => readResources(bytes.slice(0, 17)), /Truncated/);
  assert.throws(() => writeResources(resources, { maxBytes: 8 }), /limit/);
});

for (const text of [
  '<root><data name="X"><value>a</value></data><data name="X"><value>b</value></data></root>',
  '<root><data name="X" mimetype="application/x-microsoft.net.object.binary.base64"><value>AA==</value></data></root>',
  '<root><data name="X" type="System.Int32"><value>999999999999</value></data></root>',
  '<root><data name="X" type="Custom.Type"><value>x</value></data></root>',
  '<!DOCTYPE root><root/>',
]) test('unsupported or invalid resources are rejected', () => assert.throws(() => parseResx(text)));

const manifestCases = [
  ['Strings.resx', {}, 'App.Strings.resources', ''],
  ['folder/Strings.resx', {}, 'App.folder.Strings.resources', ''],
  ['Strings.fr.resx', {}, 'App.Strings.fr.resources', 'fr'],
  ['Strings.pl-PL.resx', {}, 'App.Strings.pl-PL.resources', 'pl-PL'],
  ['Strings.resx', { LogicalName: 'Exact.Name' }, 'Exact.Name', ''],
  ['Strings.resx', { ManifestResourceName: 'Override.Name' }, 'Override.Name.resources', ''],
  ['Strings.resx', { Link: 'linked/Strings.resx' }, 'App.linked.Strings.resources', ''],
  ['Strings.fr.resx', { WithCulture: 'false' }, 'App.Strings.fr.resources', ''],
  ['Payload.txt', {}, 'App.Payload.txt', ''],
  ['Payload.bin', { LogicalName: 'bytes' }, 'bytes', ''],
  ['Name.resx', { DependentUpon: 'Types.cs' }, 'Example.Type.resources', ''],
  ['Name.fr.resx', { DependentUpon: 'Types.cs' }, 'Example.Type.fr.resources', 'fr'],
];
for (const [path, metadata, manifestName, culture] of manifestCases) test('manifest resource identity ' + path + JSON.stringify(metadata), () => {
  const xml = '<Project><PropertyGroup><RootNamespace>App</RootNamespace></PropertyGroup><ItemGroup>'
    + `<EmbeddedResource Include="${path}">${Object.entries(metadata).map(([name, value]) => `<${name}>${value}</${name}>`).join('')}`
    + '</EmbeddedResource></ItemGroup></Project>';
  const result = evaluate(xml, { ['App/' + path]: path.endsWith('.resx') ? '<root/>' : 'payload',
    'App/Types.cs': 'namespace Example; class Type {}' });
  noErrors(result);
  assert.equal(result.project.resources[0].manifestName, manifestName);
  assert.equal(result.project.resources[0].culture, culture);
});

test('resx file references resolve only within the supplied virtual workspace', () => {
  const result = evaluate('<Project><ItemGroup><EmbeddedResource Include="Resources.resx"/></ItemGroup></Project>', {
    'App/Resources.resx': '<root><data name="Text" type="System.Resources.ResXFileRef, System.Windows.Forms">'
      + '<value>data.txt;System.String;utf-8</value></data></root>', 'App/data.txt': 'content',
  });
  noErrors(result);
  assert.equal(readResources(result.project.resources[0].bytes)[0].value, 'content');
  assert.throws(() => parseResx('<root><data name="F" type="System.Resources.ResXFileRef"><value>x;System.String</value></data></root>'),
    /virtual file access/);
});

test('output layout includes copied content, links, publish policy and referenced project files', () => {
  const result = evaluate(`<Project><ItemGroup>
    <Content Include="appsettings.json" CopyToOutputDirectory="PreserveNewest"/>
    <None Include="../shared/readme.txt" Link="docs/readme.txt" CopyToOutputDirectory="Always" CopyToPublishDirectory="Never"/>
    <None Include="skip.txt" CopyToOutputDirectory="Never"/>
    <ProjectReference Include="../Lib/Lib.csproj"/>
  </ItemGroup></Project>`, {
    'Lib/Lib.csproj': '<Project><ItemGroup><Content Include="data.json" CopyToOutputDirectory="PreserveNewest"/></ItemGroup></Project>',
    'App/appsettings.json': '{}', 'shared/readme.txt': 'readme', 'App/skip.txt': 'skip', 'Lib/data.json': '{}',
  });
  noErrors(result);
  const layout = result.system.outputLayout();
  assert.deepEqual(layout.output.map(file => file.target), ['data.json', 'appsettings.json', 'docs/readme.txt']);
  assert.deepEqual(layout.publish.map(file => file.target), ['data.json', 'appsettings.json']);
  assert.equal(layout.output.find(file => file.target === 'appsettings.json').mode, 'PreserveNewest');
});

test('output layout rejects traversal and conflicting destinations', () => {
  const result = evaluate('<Project><ItemGroup><None Include="one" Link="same" CopyToOutputDirectory="Always"/>'
    + '<None Include="two" Link="same" CopyToOutputDirectory="Always"/></ItemGroup></Project>');
  assert.throws(() => result.system.outputLayout(), /conflicting/);
  const escaped = evaluate('<Project><ItemGroup><None Include="one" Link="../outside" CopyToOutputDirectory="Always"/></ItemGroup></Project>');
  assert.throws(() => escaped.system.outputLayout(), /escapes/);
});

test('launch settings accept comments/trailing commas and select the requested run context', () => {
  const result = evaluate('<Project/>', { 'App/Properties/launchSettings.json': `{
    // Team run defaults
    "profiles": {
      "Dev": {"commandName":"Project", "commandLineArgs":"--name \\\"two words\\\"", "environmentVariables":{"MODE":"dev"}},
      "Other": {"commandName":"Project", "commandLineArgs":"--count 2", "applicationUrl":"http://localhost:5000",},
    },
  }` }, { launchProfile: 'Other' });
  noErrors(result);
  const options = result.system.runOptions();
  assert.equal(options.profile, 'Other');
  assert.deepEqual(options.args, ['--count', '2']);
  assert.equal(options.environment.ASPNETCORE_URLS, 'http://localhost:5000');
  assert.deepEqual(result.system.runOptions(undefined, { profile: 'Dev' }).args, ['--name', 'two words']);
  assert.equal(result.system.runOptions(undefined, { profile: 'Dev' }).environment.MODE, 'dev');
  assert.deepEqual(parseLaunchArguments('"" one \'two words\''), ['', 'one', 'two words']);
});

test('invalid launch settings are located diagnostics and unknown profiles are rejected', () => {
  const result = readLaunchSettings('{\n "profiles": !\n}', { path: 'launchSettings.json' });
  assert.equal(result.diagnostics[0].code, 'SFP1701');
  assert.equal(result.diagnostics[0].line, 2);
  assert.equal(result.diagnostics[0].start, 15);
  const profiles = readLaunchSettings('{"profiles":{"One":{"commandName":"Project"}}}', { profile: 'Missing' });
  assert(profiles.diagnostics.some(diagnostic => /does not exist/.test(diagnostic.message)));
  assert.throws(() => parseLaunchArguments('"unfinished'), /Unterminated/);
});

test('shared JSONC parser preserves Unicode, comments, strings, trailing commas and safe object keys', () => {
  const parsed = parseConfigurationJson('\uFEFF{"emoji":"😀",/* comment */"url":"https://example.test", "list":[1,true,null,], "__proto__":{"value":2},}');
  assert.equal(parsed.emoji, '😀');
  assert.equal(parsed.url, 'https://example.test');
  assert.deepEqual(parsed.list, [1, true, null]);
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
  assert.throws(() => parseConfigurationJson('{"emoji":"😀", "bad":!}'), error => error.code === 'SFJSON001' && error.start === 21);
  assert.throws(() => parseConfigurationJson('[[[0]]]', { maxDepth: 1 }), /nesting/);
  assert.throws(() => parseConfigurationJson('[1,2,3]', { maxNodes: 2 }), /node limit/);
  assert.throws(() => parseConfigurationJson('{"x":"\\q"}'), /escape/);
});

test('B05 mixed slnx projects remain visible as explicit unloaded nodes', () => {
  const system = new ProjectSystem([
    { path: 'Mixed.slnx', text: '<Solution><Project Path="C.csproj"/><Project Path="F.fsproj"/><Project Path="N.vcxproj"/></Solution>' },
    { path: 'C.csproj', text: '<Project/>' },
    { path: 'F.fsproj', text: '<Project/>' },
    { path: 'N.vcxproj', text: '<Project/>' },
  ]);
  const snapshot = system.load('Mixed.slnx');
  assert.equal(snapshot.projects.length, 3);
  assert.equal(snapshot.projects.filter(project => project.unloaded).length, 2);
  assert(snapshot.projects.filter(project => project.unloaded).every(project => /native toolchain/.test(project.reason)));
});

test('lazy file records participate in evaluation but must hydrate before compilation', () => {
  const system = new ProjectSystem([
    { path: 'App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"/>' },
    { path: 'Program.cs', size: 40, lastModified: 1, lazy: true },
  ]);
  const snapshot = system.load('App.csproj');
  noErrors(snapshot);
  assert.equal(snapshot.projects[0].compile[0].path, 'Program.cs');
  assert.throws(() => system.compilationFiles(), /hydrate/);
  assert.throws(() => system.buildPlan(), /missing/);
  system.files.set('Program.cs', { path: 'Program.cs', text: 'class Program {}' });
  assert.equal(system.buildPlan().units[0].sources.length, 1);
});

test('resource file references and dependent source naming reject unhydrated records', () => {
  const reference = '<root><data name="Text" type="System.Resources.ResXFileRef">'
    + '<value>payload.txt;System.String</value></data></root>';
  assert.throws(() => parseResx(reference, {
    readFile: () => ({ path: 'payload.txt', lazy: true, size: 12 }),
    resolvePath: path => path,
  }), /hydrated/);
  const system = new ProjectSystem([
    { path: 'App.csproj', text: '<Project><ItemGroup><EmbeddedResource Include="Name.resx">'
      + '<DependentUpon>Types.cs</DependentUpon></EmbeddedResource></ItemGroup></Project>' },
    { path: 'Name.resx', text: '<root/>' },
    { path: 'Types.cs', lazy: true, size: 32 },
  ]);
  const snapshot = system.load('App.csproj');
  assert(snapshot.diagnostics.some(diagnostic => /hydrated/.test(diagnostic.message)));
  assert.equal(snapshot.projects[0].resources.length, 0);
});
