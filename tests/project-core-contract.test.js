import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSystem } from '../packages/project-system/src/index.js';

function workspace(project, files = [], options = {}) {
  const system = new ProjectSystem([{ path: 'App/App.csproj', text: project }, ...files], options);
  const snapshot = system.load('App/App.csproj');
  return { system, snapshot, project: system.projects.get('App/App.csproj') };
}

const multiTarget = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
  + '<TargetFrameworks>net8.0;net10.0</TargetFrameworks><EnableDefaultCompileItems>false</EnableDefaultCompileItems>'
  + '<GenerateAssemblyInfo>false</GenerateAssemblyInfo></PropertyGroup>'
  + '<ItemGroup Condition="\'$(TargetFramework)\' == \'net8.0\'"><Compile Include="Eight.cs"/></ItemGroup>'
  + '<ItemGroup Condition="\'$(TargetFramework)\' == \'net10.0\'"><Compile Include="Ten.cs"/></ItemGroup></Project>';

test('ProjectSystem evaluates each framework with isolated properties, items, generated data and stable selection IDs', () => {
  const result = workspace(multiTarget, [{ path: 'App/Eight.cs', text: '' }, { path: 'App/Ten.cs', text: '' }]);
  assert.equal(result.snapshot.diagnostics.filter(diagnostic => diagnostic.severity === 'error').length, 0);
  const [eight, ten] = result.project.contexts;
  assert.equal(eight.targetFramework, 'net8.0');
  assert.equal(ten.targetFramework, 'net10.0');
  assert.deepEqual(eight.compile.map(item => item.path), ['App/Eight.cs']);
  assert.deepEqual(ten.compile.map(item => item.path), ['App/Ten.cs']);
  assert.notEqual(eight.contextId, ten.contextId);
  assert.notEqual(eight.properties, ten.properties);
  assert.notEqual(eight.evaluatedItems, ten.evaluatedItems);
  assert.equal(result.system.getContext('App/App.csproj').contextId, eight.contextId);
  assert.equal(result.system.getContext('App/App.csproj', ten.contextId), ten);
  const selected = result.system.selectContext('App/App.csproj', ten.contextId);
  assert.equal(selected.targetFramework, 'net10.0');
  assert.deepEqual(result.system.compilationFiles().map(file => file.uri), ['App/Ten.cs']);
  const released = result.system.selectContext('App/App.csproj', { configuration: 'Release' });
  assert.equal(released.targetFramework, 'net10.0');
  assert.equal(released.effectiveConfiguration, 'Release');
  assert.equal(result.system.compilationOptions().preprocessorSymbols.includes('DEBUG'), false);
  assert.equal(result.system.getContext('App/App.csproj', ten.contextId), null);
});

test('metadata-only Compile records are accepted but never compiled as fabricated empty text', () => {
  const result = workspace('<Project><ItemGroup><Compile Include="Program.cs"/></ItemGroup></Project>', [
    { path: 'App/Program.cs', lazy: true, size: 42 },
  ]);
  assert.equal(result.project.compile.length, 1);
  assert.equal(result.snapshot.diagnostics.some(diagnostic => diagnostic.code === 'SFP1005'), false);
  assert.throws(() => result.system.text('App/Program.cs'), /Missing text file/);
  assert.throws(() => result.system.compilationFiles(), /hydrated/);
  const file = result.system.setBuildFile('App/Program.cs', { text: 'class Program {}', version: 2 });
  assert.equal(file.lazy, false);
  assert.equal(result.system.buildFile('App/Program.cs'), file);
  assert.deepEqual(result.system.compilationFiles(), [{ uri: 'App/Program.cs', text: 'class Program {}', version: 2 }]);
  assert.throws(() => result.system.setBuildFile('App/Program.cs', { lazy: true, size: 10 }), /contents/);
  assert.throws(() => new ProjectSystem([{ path: 'a.cs', lazy: true, size: -1 }]), /No file contents/);
});

test('resource hydration inputs propagate through the public session without changing source membership', () => {
  const result = workspace('<Project><ItemGroup><EmbeddedResource Include="Strings.resx"/></ItemGroup></Project>', [
    { path: 'App/Strings.resx', lazy: true, size: 30 }, { path: 'App/Strings.cs', lazy: true, size: 40 },
    { path: 'App/message.txt', lazy: true, size: 5 },
  ]);
  assert.deepEqual(result.system.evaluationInputs(), ['App/Strings.resx', 'App/Strings.cs']);
  result.system.setBuildFile('App/Strings.resx', { text: '<root><data name="Text" type="System.Resources.ResXFileRef">'
    + '<value>message.txt;System.String</value></data></root>' });
  assert.deepEqual(result.system.evaluationInputs(), ['App/Strings.resx', 'App/Strings.cs', 'App/message.txt']);
  assert.equal(result.system.files.get('App/Strings.cs').lazy, true);
  assert.equal(result.project.compile.length, 0);
});

test('B05 classic solution loading keeps unsupported project placeholders outside portable compilation', () => {
  const projectType = 'FAE04EC0-301F-11D3-BF4B-00C04F79EFBC';
  const line = (id, name, path) => `Project("{${projectType}}") = "${name}", "${path}", `
    + `"{00000000-0000-0000-0000-00000000000${id}}"\nEndProject\n`;
  const text = 'Microsoft Visual Studio Solution File, Format Version 12.00\n'
    + line(1, 'App', 'App/App.csproj') + line(2, 'Native', 'Native/Native.vcxproj') + line(3, 'FSharp', 'FSharp/Library.fsproj');
  const system = new ProjectSystem([{ path: 'Workspace.sln', text }, { path: 'App/App.csproj', text: '<Project/>' }]);
  const snapshot = system.load('Workspace.sln');
  assert.equal(snapshot.solution.name, 'Workspace');
  assert.deepEqual(snapshot.solution.projectPaths, ['App/App.csproj']);
  assert.equal(snapshot.projects.length, 3);
  for (const path of ['Native/Native.vcxproj', 'FSharp/Library.fsproj']) {
    const project = system.projects.get(path);
    assert.equal(project.unloaded, true);
    assert.equal(project.supported, false);
    assert.match(project.reason, /native toolchain/);
    assert.deepEqual(project.compile, []);
  }
  assert.deepEqual(system.compilationFiles('App/App.csproj'), []);
});

test('context limits, cancellation and invalid selection produce explicit failures', () => {
  const limited = workspace(multiTarget, [], { limits: { frameworks: 1 } });
  assert(limited.snapshot.diagnostics.some(diagnostic => diagnostic.code === 'SFP1903'));
  assert.equal(limited.project, undefined);
  const controller = new AbortController();
  controller.abort();
  const cancelled = workspace('<Project><PropertyGroup><X>1</X></PropertyGroup></Project>', [], { signal: controller.signal });
  assert(cancelled.snapshot.diagnostics.some(diagnostic => diagnostic.code === 'SFP1099'));
  const valid = workspace('<Project/>');
  assert.throws(() => valid.system.selectContext('App/App.csproj', 'unknown'), /not loaded/);
  assert.throws(() => valid.system.selectContext('App/App.csproj', { configuration: 'x'.repeat(257) }), /dimension/);
  assert.throws(() => new ProjectSystem([{ path: 'a.cs', text: '' }], { maxFiles: 0 }), /limit/);
});
