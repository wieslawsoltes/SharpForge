import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './helpers/project-evaluation.js';

const project = items => '<Project><PropertyGroup><ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>'
  + '</PropertyGroup><ItemGroup>' + items + '</ItemGroup></Project>';
const policyErrors = result => result.diagnostics.filter(diagnostic => diagnostic.code.startsWith('NU'));

test('central versions and explicit overrides preserve package metadata', () => {
  const result = evaluate(project('<PackageVersion Include="First" Version="1.2.3"/><PackageVersion Include="Second" Version="2.0.0"/>'
    + '<PackageReference Include="first" PrivateAssets="all"/><PackageReference Include="Second" VersionOverride="2.1.0"/>'));
  assert.deepEqual(result.project.packageReferences.map(reference => reference.version), ['1.2.3', '2.1.0']);
  assert.equal(result.project.packageReferences[0].metadata.PrivateAssets, 'all');
  assert.deepEqual(policyErrors(result), []);
});

test('global package references follow installed NuGet.targets asset and version promotion', () => {
  const result = evaluate(project('<GlobalPackageReference Include="Build.Tools" Version="3.2.1"/>'));
  const reference = result.project.packageReferences[0];
  assert.equal(reference.name, 'Build.Tools');
  assert.equal(reference.version, '3.2.1');
  assert.equal(reference.metadata.PrivateAssets, 'All');
  assert.equal(reference.metadata.IncludeAssets, 'Runtime;Build;Native;contentFiles;Analyzers');
  assert.equal(result.project.evaluatedItems.PackageVersion[0].identity, 'Build.Tools');
  assert.deepEqual(policyErrors(result), []);
  const disabled = evaluate(project('<GlobalPackageReference Include="Build.Tools" Version="3.2.1"/>')
    .replace('</PropertyGroup>', '<RestoreEnableGlobalPackageReference>false</RestoreEnableGlobalPackageReference></PropertyGroup>'));
  assert.equal(disabled.project.packageReferences.length, 0);
});

test('central references report NU1008, NU1010 and NU1013 rather than accepting invalid version policy', () => {
  const cases = [
    ['<PackageReference Include="Direct" Version="1.0.0"/>', 'NU1008'],
    ['<PackageReference Include="Missing"/>', 'NU1010'],
    ['<PackageReference Include="Override" VersionOverride="2.0.0"/>', 'NU1013'],
  ];
  for (const [items, expected] of cases) {
    const result = evaluate(project(items).replace('</PropertyGroup>',
      '<CentralPackageVersionOverrideEnabled>false</CentralPackageVersionOverrideEnabled></PropertyGroup>'));
    assert(policyErrors(result).some(diagnostic => diagnostic.code === expected && diagnostic.severity === 'error'));
  }
});

test('central package values remain isolated across framework contexts', () => {
  const result = evaluate('<Project><PropertyGroup><TargetFrameworks>net8.0;net10.0</TargetFrameworks>'
    + '<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally></PropertyGroup><ItemGroup>'
    + '<PackageVersion Include="Framework" Version="8.0.0" Condition="\'$(TargetFramework)\' == \'net8.0\'"/>'
    + '<PackageVersion Include="Framework" Version="10.0.0" Condition="\'$(TargetFramework)\' == \'net10.0\'"/>'
    + '<PackageReference Include="Framework"/></ItemGroup></Project>');
  assert.deepEqual(result.project.contexts.map(context => context.packageReferences[0].version), ['8.0.0', '10.0.0']);
});
