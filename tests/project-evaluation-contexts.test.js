import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSystem, ProjectContextSelection, projectContextId } from '../packages/project-system/src/index.js';

function system(files, options = {}) {
  const value = new ProjectSystem(Object.entries(files).map(([path, text]) => ({ path, text })), options);
  value.load('App/App.csproj');
  return value;
}

const multiProject = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
  + '<TargetFrameworks>net8.0;net10.0</TargetFrameworks><EnableDefaultCompileItems>false</EnableDefaultCompileItems>'
  + '</PropertyGroup><ItemGroup><Compile Include="$(TargetFramework).cs"/></ItemGroup></Project>';

test('inner evaluations isolate framework-conditioned sources, properties, items and generated documents', () => {
  const projectSystem = system({ 'App/App.csproj': multiProject, 'App/net8.0.cs': 'class Eight {}', 'App/net10.0.cs': 'class Ten {}' });
  const project = projectSystem.projects.get('App/App.csproj');
  assert.equal(project.contexts.length, 2);
  assert.deepEqual(project.contexts.map(context => context.compile.map(item => item.path)), [['App/net8.0.cs'], ['App/net10.0.cs']]);
  assert.deepEqual(project.contexts.map(context => context.properties.langversion), ['12.0', '14.0']);
  assert.notEqual(project.contexts[0].properties, project.contexts[1].properties);
  assert.notEqual(project.contexts[0].evaluatedItems, project.contexts[1].evaluatedItems);
  assert(project.contexts.every(context => context.generatedSources.every(source => source.path.includes(context.targetFramework))));
  assert.equal(projectSystem.getContext(project.path).targetFramework, 'net8.0');
  assert.equal(projectSystem.snapshot().diagnostics.length, 0);
});

test('inactive context diagnostics are labeled and cannot block the selected build context', () => {
  const project = multiProject.replace('</Project>', '<PropertyGroup Condition="\'$(TargetFramework)\' == \'net10.0\'">'
    + '<Unsupported>$([Blocked.Type]::Run())</Unsupported></PropertyGroup></Project>');
  const projectSystem = system({ 'App/App.csproj': project, 'App/net8.0.cs': '', 'App/net10.0.cs': '' });
  const diagnostics = projectSystem.snapshot().diagnostics;
  assert(diagnostics.length > 0);
  assert(diagnostics.every(diagnostic => diagnostic.targetFramework === 'net10.0' && diagnostic.contextId.includes('net10.0')));
  assert.equal(projectSystem.buildPlan().diagnostics.length, 0);
  projectSystem.selectContext('App/App.csproj', { targetFramework: 'net10.0' });
  assert(projectSystem.buildPlan().diagnostics.some(diagnostic => diagnostic.severity === 'error'));
});

test('active context changes re-evaluate configuration/runtime and invalidate stale identities', () => {
  const projectSystem = system({ 'App/App.csproj': multiProject, 'App/net8.0.cs': '', 'App/net10.0.cs': '' });
  const previous = projectSystem.getContext('App/App.csproj').id;
  const selected = projectSystem.selectContext('App/App.csproj', {
    targetFramework: 'net10.0', runtimeIdentifier: 'win-x64', configuration: 'Release', platform: 'x64',
  });
  assert.equal(selected.properties.configuration, 'Release');
  assert.equal(selected.properties.platform, 'x64');
  assert.equal(selected.properties.runtimeidentifier, 'win-x64');
  assert(!projectSystem.compilationOptions().defines.includes('DEBUG'));
  assert(projectSystem.compilationOptions().defines.includes('NET10_0'));
  assert.equal(projectSystem.getContext(selected.path, previous), null);
  assert.equal(projectSystem.runOptions().contextId, selected.contextId);
  assert.equal(projectSystem.runOptions().runtimeIdentifier, 'win-x64');
  assert.throws(() => projectSystem.selectContext(selected.path, { targetFramework: 'net7.0' }), /not declared/);
  assert.equal(projectSystem.getContext(selected.path).id, selected.id);
});

test('ProjectReference selects nearest compatible framework independently of the explorer active context', () => {
  const projectSystem = system({
    'App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup>'
      + '<ItemGroup><ProjectReference Include="../Lib/Lib.csproj"/></ItemGroup></Project>',
    'Lib/Lib.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
      + '<TargetFrameworks>netstandard2.0;net8.0;net10.0</TargetFrameworks></PropertyGroup></Project>',
    'App/Program.cs': '', 'Lib/Code.cs': '',
  });
  assert.equal(projectSystem.getContext('Lib/Lib.csproj').targetFramework, 'netstandard2.0');
  const contexts = projectSystem.buildContexts();
  assert.deepEqual(contexts.map(context => context.targetFramework), ['net10.0', 'net10.0']);
  const plan = projectSystem.buildPlan();
  assert.equal(plan.units[1].references[0].contextId, plan.units[0].contextId);
  assert.equal(plan.startupContextId, plan.units[1].contextId);
});

test('diamond dependencies retain two independently compiled contexts of the same library', () => {
  const references = paths => '<ItemGroup>' + paths.map(path => `<ProjectReference Include="${path}"/>`).join('') + '</ItemGroup>';
  const project = (framework, paths) => '<Project><PropertyGroup><TargetFramework>' + framework
    + '</TargetFramework></PropertyGroup>' + references(paths) + '</Project>';
  const projectSystem = system({
    'App/App.csproj': project('net10.0', ['../Older/Older.csproj', '../Newer/Newer.csproj']),
    'Older/Older.csproj': project('net8.0', ['../Lib/Lib.csproj']),
    'Newer/Newer.csproj': project('net10.0', ['../Lib/Lib.csproj']),
    'Lib/Lib.csproj': '<Project><PropertyGroup><TargetFrameworks>net8.0;net10.0</TargetFrameworks></PropertyGroup></Project>',
  });
  const plan = projectSystem.buildPlan();
  assert.equal(plan.units.length, 5);
  assert.deepEqual(plan.units.filter(unit => unit.project === 'Lib/Lib.csproj').map(unit => unit.targetFramework), ['net8.0', 'net10.0']);
  assert.equal(new Set(plan.units.map(unit => unit.contextId)).size, 5);
  assert.notEqual(plan.units[1].references[0].contextId, plan.units[3].references[0].contextId);
});

test('portable targets update only the requested framework context and preserve the selected context', () => {
  const project = multiProject.replace('</Project>', '<Target Name="Generate">'
    + '<WriteLinesToFile File="$(IntermediateOutputPath)Version.cs" Lines="// $(TargetFramework)" Overwrite="true"/>'
    + '<ItemGroup><Compile Include="$(IntermediateOutputPath)Version.cs"/></ItemGroup></Target></Project>');
  const projectSystem = system({ 'App/App.csproj': project, 'App/net8.0.cs': '', 'App/net10.0.cs': '' });
  const context = projectSystem.getContext('App/App.csproj', { targetFramework: 'net10.0' });
  const result = projectSystem.runTargets(context.path, 'Generate', { contextId: context.id });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.equal(projectSystem.getContext(context.path).targetFramework, 'net8.0');
  assert.equal(projectSystem.getContext(context.path).compile.length, 1);
  assert.equal(projectSystem.getContext(context.path, context.id).compile.length, 2);
  assert.equal(result.files.find(file => file.path.includes('Version.cs')).text, '// net10.0\n');
  assert.throws(() => projectSystem.runTargets(context.path, 'Generate', { contextId: 'unknown' }), /context/);
});

test('context graphs reject incompatible references and context-budget overflow explicitly', () => {
  const projectSystem = system({ 'App/App.csproj': '<Project><PropertyGroup><TargetFramework>net48</TargetFramework></PropertyGroup>'
    + '<ItemGroup><ProjectReference Include="../Lib/Lib.csproj"/></ItemGroup></Project>',
  'Lib/Lib.csproj': '<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>' });
  assert.throws(() => projectSystem.buildPlan(), /No compatible/);
  const bounded = system({ 'App/App.csproj': multiProject }, { limits: { frameworks: 1 } });
  assert(bounded.snapshot().diagnostics.some(diagnostic => /context limit/.test(diagnostic.message)));
});

test('shared native/portable selection removes obsolete contexts on replacement', () => {
  const selection = new ProjectContextSelection();
  const create = targetFramework => {
    const context = { project: 'App.csproj', targetFramework, diagnostics: [] };
    return { ...context, id: projectContextId(context) };
  };
  const first = create('net8.0');
  const second = create('net10.0');
  selection.update([first, second]);
  selection.select(first.project, second.id);
  selection.update([first]);
  assert.equal(selection.get(first.project), first);
  assert.throws(() => selection.select(first.project, second.id), /unavailable/);
  assert.deepEqual(selection.diagnostics(), []);
});

test('selected contexts expose metadata-only paths before hydration and preserve available assembly bytes', () => {
  const value = new ProjectSystem([
    { path: 'App/App.csproj', text: '<Project><ItemGroup><Compile Include="Code.cs"/>'
      + '<Reference Include="Lib"><HintPath>Lib.dll</HintPath></Reference></ItemGroup></Project>' },
    { path: 'App/Code.cs', lazy: true, size: 12 },
    { path: 'App/Lib.dll', bytes: new Uint8Array([77, 90]) },
  ]);
  value.load('App/App.csproj');
  assert.equal(value.snapshot().diagnostics.length, 0);
  assert.equal(value.buildContexts()[0].compile[0].path, 'App/Code.cs');
  assert.throws(() => value.buildPlan(), /missing/);
  value.files.set('App/Code.cs', { path: 'App/Code.cs', text: 'class Code {}' });
  assert.deepEqual(value.buildPlan().units[0].metadataReferences[0].bytes, new Uint8Array([77, 90]));
});

test('resource input discovery expands after resx hydration and never loads unrelated compile files', () => {
  const value = new ProjectSystem([
    { path: 'App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
      + '<TargetFrameworks>net8.0;net10.0</TargetFrameworks></PropertyGroup></Project>' },
    { path: 'Strings.resx', lazy: true, size: 50 },
    { path: 'Strings.cs', lazy: true, size: 20 },
    { path: 'Other.cs', lazy: true, size: 20 },
    { path: 'payload.txt', lazy: true, size: 20 },
  ]);
  value.load('App.csproj');
  assert.deepEqual(value.evaluationInputs().sort(), ['Strings.cs', 'Strings.resx']);
  value.files.set('Strings.resx', { path: 'Strings.resx', text: '<root><data name="Payload" type="System.Resources.ResXFileRef">'
    + '<value>payload.txt;System.String</value></data></root>' });
  assert.deepEqual(value.evaluationInputs().sort(), ['Strings.cs', 'Strings.resx', 'payload.txt']);
  assert.equal(value.files.get('Other.cs').text, undefined);
  assert(value.files.get('Other.cs').lazy);
});
