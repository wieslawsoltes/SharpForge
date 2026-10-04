import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectSystem} from '@sharpforge/project-system';
import {readPE} from '@sharpforge/cil';
import {compileProjectPlan} from '../apps/studio/workers/compilation-handler.js';
import {prepareProjectRequest, finalizeProjectBuild, requestProjectCompilation, projectBuildErrors}
  from '../apps/studio/project-build.js';

const sdk = (body = '', properties = '', framework = 'net10.0') => '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
  + `<TargetFramework>${framework}</TargetFramework><GenerateAssemblyInfo>false</GenerateAssemblyInfo>`
  + properties + '</PropertyGroup>' + body + '</Project>';

function stateOf(xml, records = []) {
  const projectSystem = new ProjectSystem([{path: 'App/App.csproj', text: xml}, ...records]);
  const projectSnapshot = projectSystem.load('App/App.csproj');
  return {projectSystem, projectSnapshot, startupProject: 'App/App.csproj', files: [], revision: 1, name: 'App'};
}

const afterTargets = '<Target Name="CopyAssembly" AfterTargets="CoreCompile">'
  + '<Copy SourceFiles="$(TargetPath)" DestinationFiles="copied.dll"/></Target>'
  + '<Target Name="Finish" AfterTargets="Build"><WriteLinesToFile File="finished.txt" Lines="done" Overwrite="true"/></Target>';
const compiler = {request(method, request) {
  assert.equal(method, 'build');
  return compileProjectPlan(request.buildPlan);
}};

test('application build runs all preparation hooks and finalizes genuine compiler bytes after the worker returns', async () => {
  const state = stateOf(sdk('<ItemGroup><Compile Include="Generated.cs"/></ItemGroup>'
    + '<Target Name="First" BeforeTargets="BeforeBuild"><WriteLinesToFile File="first.txt" Lines="first"/></Target>'
    + '<Target Name="Second" BeforeTargets="BeforeBuild"><WriteLinesToFile File="second.txt" Lines="second"/></Target>'
    + '<Target Name="Generate" BeforeTargets="BeforeCompile"><WriteLinesToFile File="Generated.cs" '
    + 'Lines="public class Generated { public static int Value() { return 7%3B } }" Overwrite="true"/></Target>'
    + afterTargets, '<OutputType>Exe</OutputType>'),
  [{path: 'App/Program.cs', text: 'System.Console.WriteLine(Generated.Value());'}]);
  assert(projectBuildErrors(state).some(error => error.code === 'SFP1005'));
  let prepared;
  const result = await requestProjectCompilation(state, {request(method, request) {
    prepared = request;
    assert(state.projectSystem.files.has('App/first.txt'));
    assert(state.projectSystem.files.has('App/second.txt'));
    assert.equal(state.projectSystem.files.has('App/copied.dll'), false);
    assert.equal(state.projectSystem.files.has(request.buildPlan.units[0].output.slice(1)), false);
    assert.equal(projectBuildErrors(state).length, 0, 'targets repair missing generated Compile inputs');
    return compiler.request(method, request);
  }}, 'build');
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(state.projectSystem.files.get('App/copied.dll').bytes, result.assembly);
  assert(readPE(result.assembly).metadata.rows[32].length);
  assert.equal(state.projectSystem.files.get('App/finished.txt').text, 'done\n');
  assert.deepEqual(result.targetResults.map(phase => phase.phase), ['beforeCompile', 'afterCompile']);
  const finalizedAgain = await finalizeProjectBuild(state, prepared, result);
  assert.equal(finalizedAgain, result, 'finalizing the same request cannot execute after targets twice');
});

test('failed compilation never publishes an output assembly or executes after targets', async () => {
  const state = stateOf(sdk(afterTargets), [{path: 'App/Code.cs', text: 'class Invalid { void Method( }'}]);
  const result = await requestProjectCompilation(state, compiler, 'build');
  assert.equal(result.success, false);
  assert(result.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
  assert.equal(state.projectSystem.files.has('App/copied.dll'), false);
  assert.equal(state.projectSystem.files.has('App/finished.txt'), false);
  const unit = state.projectSystem.buildPlan().units[0];
  assert.equal(state.projectSystem.files.has(unit.output.slice(1)), false);
  assert.deepEqual(result.targetResults.map(phase => phase.phase), ['beforeCompile']);
});

test('the same generated source path stays isolated in a two-framework diamond build and on rebuild', async () => {
  const references = paths => '<ItemGroup>' + paths.map(path => `<ProjectReference Include="${path}"/>`).join('') + '</ItemGroup>';
  const library = sdk('<Target Name="Generate" BeforeTargets="CoreCompile">'
    + '<WriteLinesToFile File="Generated.cs" Lines="// $(TargetFramework);public class Generated {}" Overwrite="true"/>'
    + '<ItemGroup><Compile Include="Generated.cs"/><GeneratedOnce Include="one"/></ItemGroup></Target>',
  '<TargetFrameworks>net8.0;net10.0</TargetFrameworks><EnableDefaultCompileItems>false</EnableDefaultCompileItems>', '');
  const state = stateOf(sdk(references(['../Older/Older.csproj', '../Newer/Newer.csproj'])), [
    {path: 'Older/Older.csproj', text: sdk(references(['../Lib/Lib.csproj']), '', 'net8.0')},
    {path: 'Newer/Newer.csproj', text: sdk(references(['../Lib/Lib.csproj']))},
    {path: 'Lib/Lib.csproj', text: library},
    {path: 'App/Code.cs', text: 'public class App {}'},
    {path: 'Older/Code.cs', text: 'public class Older {}'},
    {path: 'Newer/Code.cs', text: 'public class Newer {}'},
  ]);
  for (let iteration = 0; iteration < 2; iteration++) {
    const frameworks = [];
    const compileRequest = request => {
      for (const unit of request.buildPlan.units.filter(unit => unit.project === 'Lib/Lib.csproj')) {
        frameworks.push(unit.targetFramework);
        assert.equal(unit.sources.find(source => source.uri === 'Lib/Generated.cs').text,
          '// ' + unit.targetFramework + '\npublic class Generated {}\n');
        assert.equal(state.projectSystem.getContext(unit.project, unit.contextId).evaluatedItems.GeneratedOnce.length, 1);
      }
      return compileProjectPlan(request.buildPlan);
    };
    let result;
    if (iteration === 0) {
      const prepared = await prepareProjectRequest(state, 'build');
      result = await finalizeProjectBuild(state, prepared, compileRequest(prepared));
    } else result = await requestProjectCompilation(state, {request: (_method, request) => compileRequest(request)}, 'build');
    assert.deepEqual(frameworks, ['net8.0', 'net10.0']);
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert.equal(result.projectArtifacts.length, 5);
    assert.equal(result.targetResults.filter(phase => phase.phase === 'afterCompile').length, 5);
  }
});

test('lazy pre-compile and after-compile target inputs hydrate and retry atomically in the requested context', async () => {
  const state = stateOf(sdk('<Target Name="Generate" BeforeTargets="BeforeCompile">'
    + '<Copy SourceFiles="source.txt" DestinationFiles="Generated.cs"/>'
    + '<ItemGroup><Compile Include="Generated.cs"/></ItemGroup></Target>'
    + '<Target Name="Stage" AfterTargets="AfterCompile"><Copy SourceFiles="payload.bin" DestinationFiles="staged.bin"/></Target>'
    + afterTargets), [{path: 'App/source.txt', lazy: true, size: 25}, {path: 'App/payload.bin', lazy: true, size: 3}]);
  const reads = [];
  state.disk = {load: async path => {
    reads.push(path);
    assert.equal(state.projectSystem.files.has('App/staged.bin'), false);
    if (path === 'App/source.txt') return {path, text: 'public class Generated {}'};
    assert.equal(state.projectSystem.files.has('App/copied.dll'), false, 'failed after phases roll back earlier virtual copies');
    return {path, bytes: Uint8Array.of(4, 5, 6)};
  }};
  const result = await requestProjectCompilation(state, compiler, 'build');
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(reads, ['App/source.txt', 'App/payload.bin']);
  assert.deepEqual(state.projectSystem.files.get('App/staged.bin').bytes, Uint8Array.of(4, 5, 6));
  assert.deepEqual(state.projectSystem.files.get('App/copied.dll').bytes, result.assembly);
  assert.equal(state.files.length, 0);
});

test('after-target errors fail the build and do not publish the phase partial writes', async () => {
  const state = stateOf(sdk('<Target Name="BrokenAfter" AfterTargets="CoreCompile">'
    + '<Copy SourceFiles="$(TargetPath)" DestinationFiles="partial.dll"/><Error Text="after failed" Code="FIXTURE"/></Target>'),
  [{path: 'App/Code.cs', text: 'public class Code {}'}]);
  const result = await requestProjectCompilation(state, compiler, 'build');
  assert.equal(result.success, false);
  assert(result.diagnostics.some(diagnostic => diagnostic.code === 'FIXTURE'));
  assert.equal(result.assembly, null);
  assert.equal(result.projectArtifacts[0].success, false);
  assert.equal(state.projectSystem.files.has('App/partial.dll'), false);
});

test('cancelled, stale, superseded and malformed worker results cannot execute post-compilation targets', async () => {
  for (const mode of ['cancelled', 'stale', 'superseded', 'missing-artifact', 'missing-bytes']) {
    const state = stateOf(sdk(afterTargets), [{path: 'App/Code.cs', text: 'public class Code {}'}]);
    const controller = new AbortController();
    const request = await prepareProjectRequest(state, 'build', {signal: controller.signal});
    const result = compileProjectPlan(request.buildPlan);
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    if (mode === 'cancelled') controller.abort();
    if (mode === 'stale') state.revision++;
    if (mode === 'superseded') await prepareProjectRequest(state, 'build');
    if (mode === 'missing-artifact') result.projectArtifacts = [];
    if (mode === 'missing-bytes') result.projectArtifacts[0].assembly = null;
    await assert.rejects(finalizeProjectBuild(state, request, result, {signal: controller.signal}),
      /abort|cancel|changed|superseded|artifact|assembly bytes/i);
    assert.equal(state.projectSystem.files.has('App/copied.dll'), false, mode);
    assert.equal(state.projectSystem.files.has('App/finished.txt'), false, mode);
  }
});

test('native-only property and task diagnostics survive target preparation without publishing partial writes', async () => {
  for (const [unsupported, code] of [
    ['<PropertyGroup><Unsupported>$([Blocked.Type]::Run())</Unsupported></PropertyGroup>', 'MSB4185'],
    ['<Target Name="Unsupported"><Exec Command="blocked"/></Target>', 'SFP1004'],
  ]) {
    const state = stateOf(sdk(unsupported + '<Target Name="Write" BeforeTargets="BeforeBuild">'
      + '<WriteLinesToFile File="partial.txt" Lines="must roll back"/></Target>'), [{path: 'App/Code.cs', text: ''}]);
    assert(projectBuildErrors(state).length);
    await assert.rejects(prepareProjectRequest(state, 'build'), error =>
      error.code === 'SFP1802' && error.diagnostics.some(diagnostic => diagnostic.code === code && diagnostic.severity === 'error'));
    assert.equal(state.projectSystem.files.has('App/partial.txt'), false);
  }
});

test('native semantic requests use the explicitly selected native context and skip portable targets', async () => {
  const state = {nativeMode: true, nativeProjectContext: {id: 'native-context', properties: {AssemblyName: 'Native'}},
    nativeCompilationOptions: {outputKind: 'library', nullableContext: 'enable'}, nativeContextFiles: ['Selected.cs'],
    nativeAdditionalFiles: [{path: 'input.txt', text: 'native'}], projectSystem: {buildContexts() { assert.fail('Portable evaluation was bypassed'); }},
    startupProject: 'Ignored.csproj', revision: 3, name: 'Workspace',
    files: [{uri: 'Selected.cs', text: 'class Selected {}'}, {uri: 'Other.cs', text: 'class Other {}'}]};
  const request = await prepareProjectRequest(state, 'analyze');
  assert.deepEqual(request.files.map(file => file.uri), ['Selected.cs']);
  assert.equal(request.assemblyName, 'Native');
  assert.equal(request.compilationOptions.nullableContext, 'enable');
  assert.deepEqual(request.extensions.additionalFiles, state.nativeAdditionalFiles);
  assert.equal(request.buildPlan, undefined);
});

test('disk, epoch, startup and native-mode changes cannot publish an awaited project source hydration', async () => {
  for (const changed of ['disk', 'workspaceEpoch', 'startupProject', 'nativeMode']) {
    const state = stateOf(sdk(), [{path: 'App/Code.cs', lazy: true, size: 10}]);
    state.disk = {load: async path => {
      state[changed] = changed === 'disk' ? {} : changed === 'nativeMode' ? true : 'changed';
      return {path, text: 'class Code {}'};
    }};
    await assert.rejects(prepareProjectRequest(state, 'analyze'), /Workspace changed/);
    assert.equal(state.projectSystem.files.get('App/Code.cs').lazy, true);
    assert.equal(state.projectSystem.files.get('App/Code.cs').text, undefined);
  }
});
