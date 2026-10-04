import { definition, joinPath, wrapNamespace, TemplateError } from '../common.js';
import { projectXml } from './project-xml.js';

export const testPackages = Object.freeze({
  xunit: [
    ['Microsoft.NET.Test.Sdk', '17.13.0'], ['xunit', '2.9.3'], ['xunit.runner.visualstudio', '3.0.2']
  ],
  nunit: [
    ['Microsoft.NET.Test.Sdk', '17.13.0'], ['NUnit', '4.3.2'], ['NUnit3TestAdapter', '5.0.0']
  ],
  mstest: [
    ['Microsoft.NET.Test.Sdk', '17.13.0'], ['MSTest.TestFramework', '3.8.3'], ['MSTest.TestAdapter', '3.8.3']
  ]
});

export function testClassSource(framework, name, namespace, options = {}) {
  const definitions = {
    xunit: ['using Xunit;\n', '[Fact]', 'Assert.Equal(4, 2 + 2);'],
    nunit: ['using NUnit.Framework;\n', '[Test]', 'Assert.That(2 + 2, Is.EqualTo(4));'],
    mstest: ['using Microsoft.VisualStudio.TestTools.UnitTesting;\n', '[TestMethod]', 'Assert.AreEqual(4, 2 + 2);']
  };
  const [usings, attribute, assertion] = definitions[framework];
  const body = (framework === 'mstest' ? '[TestClass]\n' : '') + `public class ${name}\n{\n` +
    `    ${attribute}\n    public void AdditionReturnsExpectedValue()\n    {\n        ${assertion}\n    }\n}`;
  return wrapNamespace(namespace, body, usings, options);
}

export function packageReferences(packages) {
  return '  <ItemGroup>\n' + packages.map(([name, version]) =>
    `    <PackageReference Include="${name}" Version="${version}"${/Adapter|runner|Test.Sdk/.test(name) ? ' PrivateAssets="all"' : ''} />`).join('\n') +
    '\n  </ItemGroup>\n';
}

export const nativeTestTemplates = Object.freeze(Object.keys(testPackages).map(framework => definition(
  framework, framework === 'xunit' ? 'xUnit Test Project' : framework === 'nunit' ? 'NUnit Test Project' : 'MSTest Test Project',
  'SDK test project with pinned packages and one passing test. Requires native dotnet restore and dotnet test.', 'Tests', {
    nativeOnly: true, nativeCompatible: true, platform: '.NET SDK', targets: ['native-dotnet'], kind: 'project',
    prerequisites: ['.NET SDK for the selected target framework', 'NuGet restore access or populated package cache'],
    qualification: { 'native-dotnet': 'pending' }, generate: generateTestProject
  }
)));

export function generateTestProject(template, options) {
  if (options.framework.startsWith('netstandard')) throw new TemplateError('SFTPL002', 'Test runners require an executable .NET target framework');
  const { name, ns, folder } = options;
  const xml = projectXml({ ...options, library: true, options: { ...options.options, outputType: 'Library' } })
    .replace('</PropertyGroup>', '    <IsTestProject>true</IsTestProject>\n    <IsPackable>false</IsPackable>\n  </PropertyGroup>')
    .replace('</Project>', packageReferences(testPackages[template.id]) + '</Project>');
  return {
    records: [
      { path: joinPath(folder, name + '.csproj'), text: xml },
      { path: joinPath(folder, 'UnitTest1.cs'), text: testClassSource(template.id, 'UnitTest1', ns, options.options) }
    ],
    folders: [], projectPath: joinPath(folder, name + '.csproj'), openFile: joinPath(folder, 'UnitTest1.cs'), library: true,
    warnings: ['Native .NET SDK and package restore required; browser execution does not implement this test framework.']
  };
}
