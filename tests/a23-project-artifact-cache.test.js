import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectSystem} from '@sharpforge/project-system';
import {compileProjectPlan} from '../apps/studio/workers/compilation-handler.js';
import {prepareProjectRequest, requestProjectCompilation} from '../apps/studio/project-build.js';

const sdk = body => '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework>'
  + '<GenerateAssemblyInfo>false</GenerateAssemblyInfo></PropertyGroup>' + body + '</Project>';

function stateOf() {
  const projectSystem = new ProjectSystem([
    {path: 'App/App.csproj', text: sdk('<ItemGroup><ProjectReference Include="../Lib/Lib.csproj"/></ItemGroup>')},
    {path: 'Lib/Lib.csproj', text: sdk('')}, {path: 'App/Code.cs', text: 'public class App {}'},
    {path: 'Lib/Code.cs', text: 'public class Library {}'},
  ]);
  projectSystem.load('App/App.csproj');
  return {projectSystem, startupProject: 'App/App.csproj', files: [], revision: 1};
}

const compiler = {request: (_method, request) => compileProjectPlan(request.buildPlan)};

test('successful sibling artifacts survive replacement of the latest analysis result and carry the emitted runtime profile', async () => {
  const state = stateOf();
  const result = await requestProjectCompilation(state, compiler, 'build');
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  state.result = result;
  const first = await prepareProjectRequest(state, 'analyze');
  assert.equal(first.compilationOptions.references.length, 1);
  assert.deepEqual(first.compilationOptions.references[0].bytes, result.projectArtifacts[0].assembly);
  assert.equal(first.compilationOptions.references[0].runtimeProfile, 'sharpforge');
  state.result = {success: true, diagnostics: [], symbols: []};
  const second = await prepareProjectRequest(state, 'analyze');
  assert.deepEqual(second.compilationOptions.references, first.compilationOptions.references);
});

test('startup changes retain valid dependency metadata; dependency source, options and context changes invalidate it', async () => {
  for (const changed of ['startup', 'dependency', 'startup-context', 'dependency-context', 'options']) {
    const state = stateOf();
    const result = await requestProjectCompilation(state, compiler, 'build');
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    if (changed.endsWith('-context')) state.projectSystem.selectContext(changed === 'startup-context' ? 'App/App.csproj' : 'Lib/Lib.csproj',
      {configuration: 'Release'});
    else if (changed === 'options') {
      state.projectSystem.setBuildFile('Lib/Lib.csproj', {text: sdk('<PropertyGroup><LangVersion>12.0</LangVersion></PropertyGroup>')});
      state.projectSystem.load('App/App.csproj');
    }
    else state.files = [{uri: changed === 'startup' ? 'App/Code.cs' : 'Lib/Code.cs', text: 'public class Changed {}', version: 2}];
    state.revision++;
    const request = await prepareProjectRequest(state, 'analyze');
    assert.equal(request.compilationOptions.references.length, changed.startsWith('startup') ? 1 : 0, changed);
  }
});

test('a later failed dependency build clears previously emitted cache entries', async () => {
  const state = stateOf();
  assert.equal((await requestProjectCompilation(state, compiler, 'build')).success, true);
  state.files = [{uri: 'Lib/Code.cs', text: 'class Broken { void Method( }', version: 2}];
  state.revision++;
  const failed = await requestProjectCompilation(state, compiler, 'build');
  assert.equal(failed.success, false);
  state.files = [];
  state.projectSystem.setBuildFile('Lib/Code.cs', {text: 'public class Library {}'});
  const request = await prepareProjectRequest(state, 'analyze');
  assert.equal(request.compilationOptions.references.length, 0);
});

test('external HintPath references preserve case-insensitive aliases without an emitted sibling profile', async () => {
  const source = stateOf();
  const built = await requestProjectCompilation(source, compiler, 'build');
  assert.equal(built.success, true);
  const projectSystem = new ProjectSystem([{path: 'App.csproj', text: sdk('<ItemGroup>'
    + '<Reference Include="External"><HintPath>External.dll</HintPath><aliases>custom;global</aliases></Reference></ItemGroup>')},
  {path: 'Code.cs', text: 'class Code {}'}, {path: 'External.dll', bytes: built.projectArtifacts[0].assembly}]);
  projectSystem.load('App.csproj');
  const request = await prepareProjectRequest({projectSystem, startupProject: 'App.csproj', files: [], revision: 1}, 'analyze');
  assert.deepEqual(request.compilationOptions.references[0].aliases, ['custom', 'global']);
  assert.equal(request.compilationOptions.references[0].runtimeProfile, undefined);
});
