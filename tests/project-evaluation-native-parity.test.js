import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectSystem, xmlEscape, writeResources, readResources } from '../packages/project-system/src/index.js';
import { resolveNativeReference, compileNativeJsonProgram } from './helpers/project-native-reference.js';

const dotnet = process.env.SHARPFORGE_DOTNET ?? process.env.DOTNET_HOST_PATH ?? 'dotnet';
const reference = spawnSync(dotnet, ['--version'], { encoding: 'utf8', timeout: 15000 });
const unavailable = reference.status !== 0 ? 'An installed .NET SDK is required for native differential evaluation.' : false;
const options = { skip: unavailable };

function nativeFixture(files, request, action) {
  const directory = mkdtempSync(join(tmpdir(), 'sharpforge-evaluation-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      const target = join(directory, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    const result = spawnSync(dotnet, ['msbuild', join(directory, 'App/App.csproj'), '-nologo', ...request], {
      encoding: 'utf8', timeout: 60000,
      env: { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' },
    });
    assert.equal(result.status, 0, `Native SDK ${reference.stdout.trim()}: ${result.stdout}\n${result.stderr}`);
    const at = result.stdout.indexOf('{');
    const native = JSON.parse(result.stdout.slice(at));
    const system = new ProjectSystem(Object.entries(files).map(([path, text]) => ({ path, text })));
    const snapshot = system.load('App/App.csproj');
    action({ native, project: snapshot.projects[0], snapshot, system, root: directory.replaceAll('\\', '/'), sdk: reference.stdout.trim() });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('portable string members match the installed native MSBuild expression evaluator', options, () => {
  const expressions = [
    '$(A.Length)', '$(A.Substring(1))', '$(A.Substring(1,2))', "$(A.Replace('a','X'))", "$(A.Trim('a'))",
    "$(A.TrimStart('a'))", "$(A.TrimEnd('a'))", '$(A.ToLower())', '$(A.ToLowerInvariant())', '$(A.ToUpper())',
    '$(A.ToUpperInvariant())', "$(A.Contains('bab'))", "$(A.StartsWith('ab'))", "$(A.EndsWith('ba'))",
    "$(A.IndexOf('ba'))", "$(A.LastIndexOf('ba'))", "$(A.Split('b'))", "$(A.PadLeft(7,'0'))",
    "$(A.PadRight(7,'0'))", "$(A.Equals('ababa'))", "$([System.String]::Copy('$(A)').Substring(1,2))", '$(A[2])',
  ];
  const body = expressions.map((expression, index) => `<P${index}>${xmlEscape(expression)}</P${index}>`).join('');
  nativeFixture({ 'App/App.csproj': `<Project><PropertyGroup><A>ababa</A>${body}</PropertyGroup></Project>` },
    ['-getProperty:' + expressions.map((value, index) => 'P' + index).join(';')], ({ native, project, sdk }) => {
      for (let index = 0; index < expressions.length; index++) {
        assert.equal(project.properties['p' + index], native.Properties['P' + index], `${sdk}: ${expressions[index]}`);
      }
    });
});

test('portable static functions and intrinsic arithmetic match native MSBuild', options, () => {
  const expressions = [
    "$([System.String]::Concat('a','b'))", '$([System.Math]::Round(2.5))', '$([System.Math]::Round(3.5))',
    "$([System.Version]::Parse('1.2.3').Major)", "$([System.Convert]::ToInt32('FF',16))", "$([System.Char]::IsDigit('4'))",
    "$([MSBuild]::Add(2,3))", "$([MSBuild]::Multiply(2,3))", "$([MSBuild]::BitwiseOr(1,2))",
    "$([MSBuild]::VersionGreaterThan('2.0-preview','1.9'))", "$([MSBuild]::GetTargetFrameworkVersion('net48'))",
    "$([MSBuild]::StableStringHash('SharpForge'))", "$([System.IO.Path]::GetFileName('x/y.txt'))",
    "$([System.IO.Path]::ChangeExtension('a.txt','cs'))", "$([MSBuild]::IsTargetFrameworkCompatible('net8.0','netstandard2.1'))",
  ];
  const body = expressions.map((expression, index) => `<P${index}>${xmlEscape(expression)}</P${index}>`).join('');
  nativeFixture({ 'App/App.csproj': `<Project><PropertyGroup>${body}</PropertyGroup></Project>` },
    ['-getProperty:' + expressions.map((value, index) => 'P' + index).join(';')], ({ native, project, sdk }) => {
      for (let index = 0; index < expressions.length; index++) {
        assert.equal(project.properties['p' + index], native.Properties['P' + index], `${sdk}: ${expressions[index]}`);
      }
    });
});

test('nested Directory.Build.props parent imports and GetPathOfFileAbove match native MSBuild', options, () => {
  nativeFixture({
    'Directory.Build.props': '<Project><PropertyGroup><Chain>parent</Chain></PropertyGroup></Project>',
    'Directory.Build.targets': '<Project><PropertyGroup><Chain>$(Chain);targets</Chain></PropertyGroup></Project>',
    'App/Directory.Build.props': '<Project>'
      + '<Import Project="$([MSBuild]::GetPathOfFileAbove(\'Directory.Build.props\', \'$(MSBuildThisFileDirectory)../\'))"/>'
      + '<PropertyGroup><Chain>$(Chain);child</Chain></PropertyGroup></Project>',
    'App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework>'
      + '<Chain>$(Chain);project</Chain></PropertyGroup></Project>',
  }, ['-getProperty:Chain;MSBuildProjectName'], ({ native, project, sdk }) => {
    assert.equal(project.properties.chain, native.Properties.Chain, `${sdk}: inherited props and targets`);
    assert.equal(project.properties.chain, 'parent;child;project;targets');
  });
});

test('portable SDK defaults match 25 native properties and default item membership', options, () => {
  const properties = ['Configuration', 'Platform', 'AssemblyName', 'RootNamespace', 'TargetFrameworkIdentifier', 'TargetFrameworkVersion',
    'LangVersion', 'Nullable', 'AllowUnsafeBlocks', 'Deterministic', 'OutputPath', 'IntermediateOutputPath', 'BaseOutputPath',
    'BaseIntermediateOutputPath', 'DebugSymbols', 'DebugType', 'Optimize', 'WarningLevel', 'GenerateAssemblyInfo',
    'EnableDefaultItems', 'EnableDefaultCompileItems', 'EnableDefaultEmbeddedResourceItems', 'EnableDefaultNoneItems', 'TargetFileName', 'Version'];
  nativeFixture({ 'App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework>'
    + '<OutputType>Exe</OutputType></PropertyGroup></Project>', 'App/Program.cs': 'class Program {}',
    'App/settings.json': '{}', 'App/Strings.resx': '<root/>' },
  ['-getProperty:' + properties.join(';'), '-getItem:Compile;EmbeddedResource;None'], ({ native, project, sdk }) => {
    const actual = Object.fromEntries(properties.map(name => [name, project.properties[name.toLowerCase()]?.toLowerCase()]));
    const expected = Object.fromEntries(properties.map(name => [name, native.Properties[name].replaceAll('\\', '/').toLowerCase()]));
    assert.deepEqual(actual, expected, `${sdk}: SDK properties`);
    for (const type of ['Compile', 'EmbeddedResource', 'None']) assert.deepEqual(
      (project.evaluatedItems[type] ?? []).map(item => item.identity).sort(),
      (native.Items[type] ?? []).map(item => item.Identity.replaceAll('\\', '/')).sort(), `${sdk}: ${type}`);
  });
});

test('portable generic item transforms, metadata and operations match native MSBuild', options, () => {
  nativeFixture({ 'App/App.csproj': `<Project><ItemDefinitionGroup><X><Default>yes</Default></X></ItemDefinitionGroup>
    <ItemGroup><X Include="src/a.cs;src/b.cs"/><X Update="src/a.cs"><Mode>updated</Mode></X>
      <Y Include="@(X->'%(RelativeDir)%(Filename).g.cs')"/><X Remove="src/b.cs"/>
    </ItemGroup></Project>` }, ['-getItem:X;Y'], ({ native, project, sdk }) => {
    for (const type of ['X', 'Y']) {
      assert.deepEqual(project.evaluatedItems[type].map(item => ({ identity: item.identity, Default: item.metadata.Default,
        Mode: item.metadata.Mode ?? '' })), native.Items[type].map(item => ({ identity: item.Identity.replaceAll('\\', '/'),
        Default: item.Default, Mode: item.Mode ?? '' })), `${sdk}: ${type}`);
    }
  });
});

test('30 ordered item-evaluation fixtures match native MSBuild', options, () => {
  const fixtures = [
    '<_X_ Include="a;b"/>',
    '<_X_ Include="a;a"/>',
    '<_X_ Include="a;b" Exclude="b"/>',
    '<_X_ Include="a;b"/><_X_ Remove="a"/>',
    '<_X_ Include="a.cs;b.txt"/><_X_ Remove="*.cs"/>',
    '<_X_ Include="a;b"/><_X_ Update="a"><M>updated</M></_X_>',
    '<_X_ Update="a"><M>early</M></_X_><_X_ Include="a"/>',
    '<_X_ Remove="a"/><_X_ Include="a"/>',
    '<_X_ Include="a;b"/><_X_ Remove="a"/><_X_ Include="a"/>',
    '<_X_ Include="a;b"/><_X_ Update="a"><M>updated</M></_X_><_X_ Remove="a"/>',
    '<_X_ Include="A;b"/><_X_ Remove="a"/>',
    '<_X_ Include="a"><M>first</M><N>%(M)-second</N></_X_>',
    '<_X_ Include="a"><M>explicit</M></_X_>',
    '<_X_ Include="a;b"/><_X_ Update="a"><M>%(_X_.Filename)</M></_X_>',
    '<_X_ Include="A;a"/>',
    '<_X_ Include="a" Condition="false"/><_X_ Include="b"/>',
    '<_X_ Include="a" Condition="\'$(Later)\' == \'yes\'"/>',
    '<_X_ Include="src/a.cs;src/b.cs"/><_Y_ Include="@(_X_->\'%(Filename).g.cs\')"/>',
    '<_X_ Include="a;b"/><_Y_ Include="@(_X_, \'|\')"/>',
    '<_X_ Include="a"><M>copied</M></_X_><_Y_ Include="@(_X_)"/>',
    '<_X_ Include="a%3Bb;c"/>',
    '<_X_ Include="a;b" Exclude="$(Excluded)"/>',
    '<_X_ Include="src/**/*.cs"/>',
    '<_X_ Include="src/**/*.cs" Exclude="src/sub/**"/>',
    '<_X_ Include="src/**/*.cs"><M>%(RecursiveDir)</M></_X_>',
    '<_X_ Include="a;b"/><_X_ Update="a"><M>override</M><N>%(M)</N></_X_>',
    '<_X_ Include="one.cs;two.cs;three.txt"/><_X_ Update="*.cs"><M>source</M></_X_>',
    '<_X_ Include="a/../b;c"/><_X_ Remove="b"/>',
    '<_X_ Include="a;b"/><_Y_ Include="a"/><_X_ Update="@(_Y_)"><M>selected</M></_X_>',
    '<_X_ Include="a;b"/><_Y_ Include="@(_X_->\'sub/%(Identity).txt\')"/>',
  ];
  const types = fixtures.flatMap((value, index) => [`X${index}`, `Y${index}`]);
  const definitions = fixtures.map((value, index) => `<X${index}><M>default</M></X${index}>`).join('');
  const body = fixtures.map((value, index) => value.replaceAll('_X_', 'X' + index).replaceAll('_Y_', 'Y' + index)).join('');
  nativeFixture({ 'App/App.csproj': '<Project><PropertyGroup><Excluded>b</Excluded></PropertyGroup>'
    + `<ItemDefinitionGroup>${definitions}</ItemDefinitionGroup><ItemGroup>${body}</ItemGroup>`
    + '<PropertyGroup><Later>yes</Later></PropertyGroup></Project>', 'App/src/a.cs': '', 'App/src/sub/b.cs': '' },
  ['-getItem:' + types.join(';')], ({ native, project, sdk }) => {
    const actual = Object.fromEntries(types.map(type => [type, (project.evaluatedItems[type] ?? []).map(item => ({
      identity: item.identity, M: item.metadata.M ?? '', N: item.metadata.N ?? '',
    }))]));
    const expected = Object.fromEntries(types.map(type => [type, (native.Items[type] ?? []).map(item => ({
      identity: item.Identity.replaceAll('\\', '/'), M: item.M ?? '', N: item.N ?? '',
    }))]));
    assert.deepEqual(actual, expected, `${sdk}: ordered item fixtures`);
  });
});

test('portable generated file target matches native WriteLinesToFile and Compile membership', options, () => {
  nativeFixture({ 'App/App.csproj': `<Project DefaultTargets="Generate">
    <Target Name="Generate"><WriteLinesToFile File="Generated.cs" Lines="class Generated { }" Overwrite="true"/>
      <ItemGroup><Compile Include="Generated.cs"/></ItemGroup></Target>
    </Project>` }, ['-target:Generate', '-getItem:Compile'], ({ native, system, root }) => {
    const result = system.runTargets('App/App.csproj');
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert.equal(result.files.find(file => file.path === 'App/Generated.cs').text,
      readFileSync(join(root, 'App/Generated.cs'), 'utf8').replaceAll('\r\n', '\n'));
    assert.deepEqual(result.project.evaluatedItems.Compile.map(item => item.identity), native.Items.Compile.map(item => item.Identity));
  });
});

test('12 resource identities match native CreateManifestResourceNames including culture and dependent sources', options, () => {
  const cases = [
    ['Strings.resx', {}],
    ['folder/Strings.resx', {}],
    ['Strings.fr.resx', {}],
    ['Strings.pl-PL.resx', {}],
    ['Logical.resx', { LogicalName: 'Exact.Name' }],
    ['Explicit.resx', { ManifestResourceName: 'Override.Name' }],
    ['Linked.resx', { Link: 'linked/Strings.resx' }],
    ['Unlocalized.fr.resx', { WithCulture: 'false' }],
    ['Payload.txt', {}],
    ['Payload.bin', { LogicalName: 'bytes' }],
    ['Name.resx', { DependentUpon: 'Types.cs' }],
    ['Name.fr.resx', { DependentUpon: 'Types.cs' }],
  ];
  const items = cases.map(([path, metadata]) => `<EmbeddedResource Include="${path}">`
    + Object.entries(metadata).map(([name, value]) => `<${name}>${value}</${name}>`).join('')
    + '</EmbeddedResource>').join('');
  const files = Object.fromEntries(cases.map(([path]) => ['App/' + path, path.endsWith('.resx') ? '<root/>' : 'payload']));
  files['App/Types.cs'] = 'namespace Example { class Type {} }';
  files['App/App.csproj'] = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework>'
    + '<RootNamespace>App</RootNamespace><EnableDefaultItems>false</EnableDefaultItems></PropertyGroup>'
    + `<ItemGroup>${items}</ItemGroup></Project>`;
  nativeFixture(files, ['-target:SplitResourcesByCulture;CreateManifestResourceNames', '-getItem:EmbeddedResource'], ({ native, project, sdk }) => {
    const actual = Object.fromEntries(project.resources.map(item => [item.path.slice(4), { name: item.manifestName, culture: item.culture }]));
    const expected = Object.fromEntries(native.Items.EmbeddedResource.map(item => [item.Identity.replaceAll('\\', '/'), {
      name: item.LogicalName || item.ManifestResourceName + (item.Type === 'Resx' ? '.resources' : ''),
      culture: item.Culture ?? '',
    }]));
    assert.deepEqual(actual, expected, `${sdk}: manifest identities`);
  });
});

function nativeResourceProgram(directory, source) {
  return compileNativeJsonProgram(resolveNativeReference(dotnet, reference.stdout.trim()), directory, source);
}

test('portable resources are readable by the native CLR and native string resources round-trip', options, () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharpforge-resources-'));
  try {
    const native = nativeResourceProgram(directory, `using System;
      using System.Collections;
      using System.Collections.Generic;
      using System.Globalization;
      using System.Resources;
      using System.Text.Json;
      class Program {
        static void Main(string[] args) {
          using (var writer = new ResourceWriter(args[1])) {
            writer.AddResource("Native", "Zażółć 😀");
            writer.AddResource("Empty", "");
            writer.Generate();
          }
          var values = new SortedDictionary<string, string>();
          using (var reader = new ResourceReader(args[0])) foreach (DictionaryEntry item in reader) {
            values[(string)item.Key] = item.Value is byte[] bytes ? Convert.ToBase64String(bytes)
              : Convert.ToString(item.Value, CultureInfo.InvariantCulture);
          }
          Console.WriteLine(JsonSerializer.Serialize(values));
        }
      }`);
    const resources = [
      { name: 'Greeting', type: 'string', value: 'Zażółć 😀' },
      { name: 'Empty', type: 'string', value: '' },
      { name: 'Integer', type: 'int32', value: 42 },
      { name: 'Long', type: 'int64', value: 9223372036854775807n },
      { name: 'Decimal', type: 'double', value: 1.25 },
      { name: 'Enabled', type: 'boolean', value: true },
      { name: 'Character', type: 'char', value: 'ą' },
      { name: 'Bytes', type: 'bytes', value: new Uint8Array([0, 128, 255]) },
    ];
    const portablePath = join(directory, 'Portable.resources');
    const nativePath = join(directory, 'Native.resources');
    writeFileSync(portablePath, writeResources(resources));
    assert.deepEqual(native([portablePath, nativePath]), {
      Bytes: 'AID/', Character: 'ą', Decimal: '1.25', Empty: '', Enabled: 'True', Greeting: 'Zażółć 😀',
      Integer: '42', Long: '9223372036854775807',
    });
    assert.deepEqual(readResources(readFileSync(nativePath)).sort((first, second) => first.name.localeCompare(second.name)), [
      { name: 'Empty', type: 'string', value: '' }, { name: 'Native', type: 'string', value: 'Zażółć 😀' },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native satellite assembly retains the culture-qualified manifest resource name', options, () => {
  const resx = '<?xml version="1.0"?><root>'
    + '<resheader name="resmimetype"><value>text/microsoft-resx</value></resheader>'
    + '<resheader name="version"><value>2.0</value></resheader>'
    + '<data name="Greeting" xml:space="preserve"><value>Bonjour</value></data></root>';
  nativeFixture({
    'NuGet.Config': '<configuration><packageSources><clear/></packageSources></configuration>',
    'App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
      + '<TargetFramework>net' + reference.stdout.trim().split('.')[0] + '.0</TargetFramework>'
      + '<AssemblyVersion>2.3.4.5</AssemblyVersion></PropertyGroup></Project>',
    'App/Strings.fr.resx': resx,
    'App/Program.cs': 'public class Program {}',
  }, ['-restore', '-target:Build', '-getProperty:TargetPath;AssemblyVersion'], ({ native, project, root }) => {
    const oracle = nativeResourceProgram(root, `using System;
      using System.Reflection;
      using System.Text.Json;
      class Program {
        static void Main(string[] args) {
          var assembly = Assembly.LoadFile(args[0]);
          Console.WriteLine(JsonSerializer.Serialize(new {
            culture = assembly.GetName().CultureName,
            version = assembly.GetName().Version.ToString(),
            resources = assembly.GetManifestResourceNames()
          }));
        }
      }`);
    const satellite = join(dirname(native.Properties.TargetPath), 'fr', 'App.resources.dll');
    assert.deepEqual(oracle([satellite]), {
      culture: 'fr', version: '2.3.4.5', resources: [project.resources[0].manifestName],
    });
    assert.equal(project.resources[0].manifestName, 'App.Strings.fr.resources');
  });
});
