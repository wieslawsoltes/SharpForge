import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSystem } from '@sharpforge/project-system';
import { compile, MetadataLanguageModel } from '@sharpforge/compiler';
import { LanguageService } from '@sharpforge/language';
import { Workspace } from '@sharpforge/workspace';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileProjectPlan } from '../apps/studio/workers/compilation-handler.js';
import { prepareProjectRequest } from '../apps/studio/project-build.js';

async function referencePlan({ visibility = 'public', friend = false } = {}) {
  const properties = '<PropertyGroup><TargetFramework>net10.0</TargetFramework>'
    + '<GenerateTargetFrameworkAttribute>false</GenerateTargetFrameworkAttribute></PropertyGroup>';
  const records = [
    { path: 'Lib/Lib.csproj', text: '<Project Sdk="Microsoft.NET.Sdk">' + properties
      + (friend ? '<ItemGroup><InternalsVisibleTo Include="App"/></ItemGroup>' : '') + '</Project>' },
    { path: 'Lib/Code.cs', text: `${visibility} class Library { public static int Answer() { return 42; } }` },
    { path: 'App/App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk">' + properties
      + '<PropertyGroup><OutputType>Exe</OutputType></PropertyGroup>'
      + '<ItemGroup><ProjectReference Include="../Lib/Lib.csproj"/></ItemGroup></Project>' },
    { path: 'App/Program.cs', text: 'System.Console.WriteLine(Library.Answer());' }
  ];
  const system = new ProjectSystem(records);
  system.load('App/App.csproj');
  const state = { projectSystem: system, startupProject: 'App/App.csproj', files: [], revision: 1, name: 'Workspace', langVersion: '14' };
  return (await prepareProjectRequest(state, 'build')).buildPlan;
}

for (const [name, settings, expected] of [
  ['public', {}, null], ['internal', { visibility: 'internal' }, 'CS0122'],
  ['friend internal', { visibility: 'internal', friend: true }, null]
]) {
  test(`real emitted project reference preserves ${name} visibility and primitive return types`, async () => {
    const plan = await referencePlan(settings);
    const result = compileProjectPlan(plan);
    const library = result.projectArtifacts.find(artifact => artifact.project === 'Lib/Lib.csproj');
    assert.equal(library.success, true, JSON.stringify(result.diagnostics));
    assert(library.assembly instanceof Uint8Array);
    const unit = plan.units.find(unit => unit.project === 'App/App.csproj');
    const sources = unit.sources.filter(source => !source.kind);
    const reference = { bytes: library.assembly, display: 'Lib.dll', runtimeProfile: 'sharpforge' };
    const semantic = new MetadataLanguageModel(sources, { ...unit.options, name: 'App', references: [reference] });
    const errors = semantic.analyze().diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    assert.equal(errors.some(diagnostic => diagnostic.code === 'CS0518'), false, JSON.stringify(errors));
    if (expected) {
      assert(errors.some(diagnostic => diagnostic.code === expected), JSON.stringify(errors));
      assert(result.diagnostics.some(diagnostic => diagnostic.code === expected), JSON.stringify(result.diagnostics));
      assert.equal(result.success, false);
      assert.equal(result.assembly, null);
    } else {
      assert.deepEqual(errors, []);
      assert.equal(result.diagnostics.some(diagnostic => /^CS\d+$/.test(diagnostic.code) && diagnostic.severity === 'error'), false,
        JSON.stringify(result.diagnostics));
      assert.equal(result.success, true, JSON.stringify(result.diagnostics));
      assert(result.assembly instanceof Uint8Array);
      const application = new AssemblyInspector(result.assembly);
      const dependency = new AssemblyInspector(library.assembly);
      assert.equal(application.types.some(type => type.name === 'Library'), false, 'App does not redefine the referenced type');
      assert(dependency.types.some(type => type.name === 'Library'));
      assert(application.summary({ includeMethods: false }).references.some(reference => reference.name === 'Lib'));
      assert.equal(result.image.externalReferences.assemblies[0].identity.name, 'Lib');
      assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === 'SF2200'), false);
    }
  });
}

test('an external reference remains strict unless its producer explicitly selects the SharpForge runtime profile', async () => {
  const plan = await referencePlan();
  const result = compileProjectPlan(plan);
  const bytes = result.projectArtifacts[0].assembly;
  const source = 'class P { static int Answer() { return Library.Answer(); } }';
  const strict = compile(source, { outputKind: 'library', references: [{ bytes }] });
  assert(strict.diagnostics.some(diagnostic => diagnostic.code === 'CS0518'), JSON.stringify(strict.diagnostics));
  const unknown = compile(source, { outputKind: 'library', references: [{ bytes, runtimeProfile: 'unknown' }] });
  assert(unknown.diagnostics.some(diagnostic => diagnostic.code === 'CS0009'), JSON.stringify(unknown.diagnostics));
});

test('metadata-backed language sessions complete imported methods, bind hover and invalidate edited sources', async () => {
  const plan = await referencePlan();
  const bytes = compileProjectPlan(plan).projectArtifacts[0].assembly;
  const workspace = new Workspace({ compilationOptions: { name: 'App', references: [{ bytes, runtimeProfile: 'sharpforge' }] } });
  const language = new LanguageService(workspace);
  workspace.update('App.cs', 'class P { static int M() { return Library.Answer(); } }');
  const first = language.metadata.current();
  const position = workspace.documents.get('App.cs').source.text.indexOf('Answer') + 1;
  assert.match(language.hover('App.cs', position).contents, /Library\.Answer/);
  assert.equal(language.definition('App.cs', position), null, 'Imported members have no editable source definition');
  assert.equal(language.diagnostics('App.cs').some(diagnostic => diagnostic.severity === 'error'), false);
  workspace.update('App.cs', 'class P { static int M() { return Library.Ans; } }');
  const offset = workspace.documents.get('App.cs').source.text.indexOf('Library.Ans') + 'Library.Ans'.length;
  assert(language.completions('App.cs', offset).some(item => item.label === 'Answer' && item.symbol.metadata));
  assert.equal(language.metadata.current(), first, 'Source edits retain decoded immutable metadata');
  assert(language.diagnostics('App.cs').some(diagnostic => diagnostic.severity === 'error'));
  workspace.compilationOptions = { name: 'App' };
  assert.equal(language.metadata.current(), null, 'Removing references evicts the metadata model');
  workspace.dispose();
});
