import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, propertyProject, noErrors, identities } from './helpers/project-evaluation.js';

test('reserved, environment and TreatAsLocalProperty values have distinct precedence', () => {
  const result = evaluate(propertyProject({ Flavor: 'local', HOME: 'project', Name: '$(MSBuildProjectFile)', This: '$(MSBuildThisFile)' },
    '', 'TreatAsLocalProperty="Flavor"'), {}, { properties: { Flavor: 'global' }, environment: { HOME: 'provided' } });
  noErrors(result);
  assert.equal(result.project.properties.flavor, 'local');
  assert.equal(result.project.properties.home, 'project');
  assert.equal(result.project.properties.name, 'App.csproj');
  assert.equal(result.project.properties.this, 'App.csproj');
  const reserved = evaluate(propertyProject({ MSBuildProjectFile: 'fake' }));
  assert.equal(reserved.project.properties.msbuildprojectfile, 'App.csproj');
  assert(reserved.diagnostics.some(diagnostic => diagnostic.code === 'MSB4004'));
});

test('per-project global mappings override solution defaults', () => {
  const result = evaluate('<Project/>', {}, { configuration: 'Debug', projectProperties: {
    'App/App.csproj': { Configuration: 'Release', Platform: 'x64' },
  } });
  noErrors(result);
  assert.equal(result.project.effectiveConfiguration, 'Release');
  assert.equal(result.project.effectivePlatform, 'x64');
});

test('SDK default properties cover configuration, framework, compilation and output layout', () => {
  const result = evaluate(propertyProject({ TargetFramework: 'net8.0', OutputType: 'Exe' }, '', 'Sdk="Microsoft.NET.Sdk"'));
  noErrors(result);
  const expected = {
    configuration: 'Debug', platform: 'AnyCPU', assemblyname: 'App', rootnamespace: 'App', targetframeworkidentifier: '.NETCoreApp',
    targetframeworkversion: 'v8.0', langversion: '12.0', nullable: '', allowunsafeblocks: 'false', deterministic: 'true',
    outputpath: 'bin/Debug/net8.0/', intermediateoutputpath: 'obj/Debug/net8.0/', baseoutputpath: 'bin/', baseintermediateoutputpath: 'obj/',
    debugsymbols: 'true', debugtype: 'portable', optimize: 'false', warninglevel: '8', generateassemblyinfo: 'true',
    enabledefaultitems: 'true', enabledefaultcompileitems: 'true', enabledefaultembeddedresourceitems: 'true', enabledefaultnoneitems: 'true',
    targetfilename: 'App.dll', version: '1.0.0',
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(result.project.properties[name], value, name);
  assert(result.project.properties.defineconstants.split(';').includes('NET8_0'));
  assert(result.project.properties.defineconstants.split(';').includes('DEBUG'));
  assert.deepEqual(result.project.compile.map(item => item.path), ['App/Program.cs']);
});

test('SDK default Compile, EmbeddedResource and None globs are disjoint and respect exclusions', () => {
  const result = evaluate('<Project Sdk="Microsoft.NET.Sdk"/>', {
    'App/a.resx': '<root><data name="Greeting"><value>Hello</value></data></root>',
    'App/appsettings.json': '{}', 'App/bin/skip.cs': '', 'App/obj/skip.resx': '', 'App/.hidden/skip.cs': '',
  });
  noErrors(result);
  assert.deepEqual(identities(result, 'Compile'), ['Program.cs']);
  assert.deepEqual(identities(result, 'EmbeddedResource'), ['a.resx']);
  assert.deepEqual(identities(result, 'None'), ['appsettings.json']);
  assert.equal(result.project.resources[0].manifestName, 'App.a.resources');
});

test('SDK default items can be disabled independently', () => {
  const result = evaluate(propertyProject({ EnableDefaultCompileItems: 'false', EnableDefaultEmbeddedResourceItems: 'false' },
    '', 'Sdk="Microsoft.NET.Sdk"'), { 'App/a.resx': '<root/>' });
  noErrors(result);
  assert.equal(result.project.compile.length, 0);
  assert.deepEqual(identities(result, 'None'), ['Program.cs', 'a.resx']);
});

test('explicit SDK imports evaluate the same key defaults as the SDK attribute', () => {
  const attribute = evaluate(propertyProject({ TargetFramework: 'net8.0' }, '', 'Sdk="Microsoft.NET.Sdk"'));
  const explicit = evaluate('<Project><Import Sdk="Microsoft.NET.Sdk" Project="Sdk.props"/>'
    + '<PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>'
    + '<Import Sdk="Microsoft.NET.Sdk" Project="Sdk.targets"/></Project>');
  noErrors(attribute);
  noErrors(explicit);
  for (const name of ['assemblyname', 'targetframework', 'defineconstants', 'outputpath', 'langversion']) {
    assert.equal(explicit.project.properties[name], attribute.project.properties[name], name);
  }
  assert.deepEqual(explicit.project.compile, attribute.project.compile);
});

test('SDK declarations and caller resolvers are explicit and unknown SDKs block evaluation', () => {
  const unknown = evaluate('<Project Sdk="Unknown.Sdk"/>');
  assert(unknown.diagnostics.some(diagnostic => diagnostic.code === 'SFP1004'));
  const result = evaluate('<Project><Sdk Name="Custom.Sdk" Version="2"/></Project>', {}, { sdkResolvers: [request => {
    if (request.name !== 'Custom.Sdk') return null;
    return { name: request.name, props: context => { context.properties.customversion = request.version; } };
  }] });
  noErrors(result);
  assert.equal(result.project.properties.customversion, '2');
  for (const sdk of ['Microsoft.NET.Sdk.Web', 'Microsoft.NET.Sdk.Worker', 'Microsoft.NET.Sdk.Razor', 'MSTest.Sdk',
    'Microsoft.Build.NoTargets', 'Microsoft.Build.Traversal']) noErrors(evaluate(`<Project Sdk="${sdk}"/>`));
});

test('Directory.Build import switches, overrides and label provenance are retained', () => {
  const files = {
    'Directory.Build.props': '<Project><PropertyGroup><Order>default</Order></PropertyGroup></Project>',
    'shared/custom.props': '<Project><PropertyGroup><Order>custom</Order></PropertyGroup></Project>',
    'Directory.Build.targets': '<Project><PropertyGroup><Order>$(Order)-targets</Order></PropertyGroup></Project>',
  };
  const disabled = evaluate('<Project/>', files, { properties: { ImportDirectoryBuildProps: 'false', ImportDirectoryBuildTargets: 'false' } });
  noErrors(disabled);
  assert.equal(disabled.project.properties.order, undefined);
  const custom = evaluate('<Project><Import Project="../shared/custom.props" Label="Explicit" Condition="true"/></Project>', files,
    { properties: { DirectoryBuildPropsPath: '../shared/custom.props' } });
  noErrors(custom);
  assert.equal(custom.project.properties.order, 'custom-targets');
  assert(custom.project.importRecords.some(record => record.path === 'shared/custom.props'));
});

test('GetPathOfFileAbove composes nested Directory.Build.props with its parent', () => {
  const result = evaluate('<Project/>', {
    'Directory.Build.props': '<Project><PropertyGroup><Value>parent</Value></PropertyGroup></Project>',
    'App/Directory.Build.props': `<Project>
      <Import Project="$([MSBuild]::GetPathOfFileAbove('Directory.Build.props', '$(MSBuildThisFileDirectory)../'))"/>
      <PropertyGroup><Value>$(Value)-child</Value></PropertyGroup>
    </Project>`,
  });
  noErrors(result);
  assert.equal(result.project.properties.value, 'parent-child');
});

test('central package versions and explicit overrides flow into PackageReference metadata', () => {
  const result = evaluate('<Project><ItemGroup><PackageReference Include="One"/><PackageReference Include="Two" VersionOverride="3.0"/>'
    + '</ItemGroup></Project>', { 'Directory.Packages.props': `<Project>
      <PropertyGroup><ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally></PropertyGroup>
      <ItemGroup><PackageVersion Include="One" Version="1.0"/><PackageVersion Include="Two" Version="2.0"/></ItemGroup>
    </Project>` });
  assert.deepEqual(result.project.packageReferences.map(item => item.version), ['1.0', '3.0']);
  assert(result.diagnostics.every(diagnostic => diagnostic.code === 'SFP1102'));
});

test('implicit global usings honor Using Remove, aliases and static metadata', () => {
  const result = evaluate(propertyProject({ TargetFramework: 'net8.0', ImplicitUsings: 'enable', GenerateAssemblyInfo: 'false' },
    '<ItemGroup><Using Remove="System.Net.Http"/><Using Include="System.Math" Static="true"/>'
    + '<Using Include="System.Collections.Generic" Alias="Collections"/></ItemGroup>', 'Sdk="Microsoft.NET.Sdk"'));
  noErrors(result);
  const source = result.project.generatedSources.find(source => source.kind === 'global-usings').text;
  for (const name of ['System', 'System.Collections.Generic', 'System.IO', 'System.Linq', 'System.Threading', 'System.Threading.Tasks']) {
    assert(source.includes('global using global::' + name + ';'), name);
  }
  assert.equal(result.project.evaluatedItems.Using.length, 8);
  assert(result.project.evaluatedItems.Using.every(item => item.path === undefined));
  assert(!source.includes('System.Net.Http'));
  assert(source.includes('global using static global::System.Math;'));
  assert(source.includes('global using Collections = global::System.Collections.Generic;'));
  assert.equal(result.system.files.has(result.project.generatedSources[0].path), false);
});

test('global using qualification preserves predefined alias types and avoids duplicate global prefixes', () => {
  const result = evaluate(propertyProject({TargetFramework: 'net10.0', GenerateAssemblyInfo: 'false'},
    '<ItemGroup><Using Include="int" Alias="Number"/><Using Include="global::System"><Seen>%(Identity)</Seen></Using>'
    + '<Using Include="System"/><Using Include="global::Unused"/><Using Remove="global::Unused"/>'
    + '<Using Update="global::System"><Updated>true</Updated></Using></ItemGroup>', 'Sdk="Microsoft.NET.Sdk"'));
  noErrors(result);
  const text = result.project.generatedSources.find(source => source.kind === 'global-usings').text;
  assert(text.includes('global using Number = int;'));
  assert.equal(text.split('global using global::System;').length - 1, 1);
  assert.equal(text.includes('global::global::'), false);
  const item = result.project.evaluatedItems.Using.find(item => item.identity === 'global::System');
  assert.deepEqual(item.metadata, {Seen: 'global::System', Updated: 'true'});
  assert.equal(text.includes('Unused'), false);
});

test('assembly info sources include versions, company and friend assemblies with escaping', () => {
  const result = evaluate(propertyProject({ TargetFramework: 'net8.0', Company: 'A "quoted" company', Version: '2.3.4' },
    '<ItemGroup><InternalsVisibleTo Include="App.Tests"/></ItemGroup>', 'Sdk="Microsoft.NET.Sdk"'));
  noErrors(result);
  const text = result.project.generatedSources.find(source => source.kind === 'assembly-info').text;
  assert(text.includes('AssemblyVersionAttribute("2.3.4.0")'));
  assert(text.includes('InternalsVisibleToAttribute("App.Tests")'));
  assert(text.includes('A \\"quoted\\" company'));
  assert(result.project.assemblyAttributes.some(attribute => attribute.type.endsWith('InternalsVisibleToAttribute') && attribute.value === 'App.Tests'));
});
