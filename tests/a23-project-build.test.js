import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectSystem} from '@sharpforge/project-system';
import {readPE, loadAssembly} from '@sharpforge/cil';
import {Workspace} from '@sharpforge/workspace';
import {compileProjectPlan, createCompilationHandler} from '../apps/studio/workers/compilation-handler.js';
import {prepareProjectRequest, projectCompilationFiles, projectLaunchOptions, hydrateWorkspaceRecords, requestProjectCompilation}
  from '../apps/studio/project-build.js';

function project(xml = '') {
  return '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework>'
    + '<OutputType>Exe</OutputType><ImplicitUsings>enable</ImplicitUsings><Company>Build fixture</Company>'
    + '</PropertyGroup>' + xml + '</Project>';
}

function workspaceState(records) {
  const system = new ProjectSystem(records);
  system.load('App/App.csproj');
  return {projectSystem: system, startupProject: 'App/App.csproj', files: [], revision: 1, name: 'Workspace', langVersion: '14'};
}

test('application compiler requests hydrate lazy inputs, retain generated usings and use current editor buffers', async () => {
  const state = workspaceState([{path: 'App/App.csproj', text: project()},
    {path: 'App/Program.cs', lazy: true, size: 24}]);
  const reads = [];
  state.disk = {load: async path => { reads.push(path); return {path, text: 'Console.WriteLine(1);', version: 1}; }};
  state.files = [{uri: 'App/Program.cs', text: 'Console.WriteLine(2);', version: 4}];
  const request = await prepareProjectRequest(state, 'build');
  assert.deepEqual(reads, ['App/Program.cs']);
  assert.equal(request.files.find(file => file.uri === 'App/Program.cs').text, 'Console.WriteLine(2);');
  assert.ok(request.files.some(file => file.kind === 'global-usings'));
  assert.equal(request.files.some(file => file.kind === 'assembly-info'), false, 'assembly metadata bypasses source attribute parsing');
  assert.ok(request.buildPlan.units[0].assemblyAttributes.some(attribute => attribute.value === 'Build fixture'));
  assert.equal(state.files.length, 1, 'hydration does not open additional editor buffers');
  assert.ok(projectCompilationFiles(state).some(file => file.kind === 'global-usings'));
});

test('generated AssemblyInfo becomes genuine metadata while the SDK project builds through the worker handler', async () => {
  const state = workspaceState([{path: 'App/App.csproj', text: project()}, {path: 'App/Program.cs', text: 'Console.WriteLine(42);'}]);
  const request = await prepareProjectRequest(state, 'build');
  const result = compileProjectPlan(request.buildPlan);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.ok(result.generatedSources.some(source => source.kind === 'assembly-info'));
  assert.ok(readPE(result.assembly).metadata.rows[12].length);
  assert.equal(result.projectArtifacts.length, 1);
  assert.ok(loadAssembly(result.assembly).sources.some(source => source.uri.endsWith('GlobalUsings.g.cs')));
});

test('dependency units keep separate source sets and suppress non-output references', () => {
  const units = [
    {project: 'Lib.csproj', assemblyName: 'Library', output: 'bin/Library.dll', options: {outputKind: 'library'},
      sources: [{uri: 'Lib.cs', text: 'public class Library {}', version: 1}], references: []},
    {project: 'App.csproj', assemblyName: 'App', output: 'bin/App.dll', options: {outputKind: 'exe'},
      sources: [{uri: 'App.cs', text: 'class App {}', version: 1}],
      references: [{project: 'Lib.csproj', output: 'bin/Library.dll', referenceOutputAssembly: false}]},
  ];
  const observed = [];
  const result = compileProjectPlan({startup: 'App.csproj', units}, {compileUnit(unit, options) {
    observed.push({sources: unit.sources.map(source => source.uri), references: options.references});
    return {success: true, diagnostics: [], assembly: Uint8Array.of(observed.length), image: {}, metrics: {errors: 0}};
  }});
  assert.equal(result.success, true);
  assert.deepEqual(observed, [{sources: ['Lib.cs'], references: []}, {sources: ['App.cs'], references: []}]);
  assert.equal(result.projectArtifacts.length, 2);
  assert.throws(() => compileProjectPlan({startup: 'App.csproj', units: units.toReversed()}), /dependency order/);
  assert.throws(() => compileProjectPlan({startup: 'none', units}), /Startup project/);
});

test('failed dependencies block consumers and do not publish a partial startup assembly', () => {
  const unit = {project: 'Lib', assemblyName: 'Lib', output: 'Lib.dll', options: {}, sources: [], references: []};
  let calls = 0;
  const result = compileProjectPlan({startup: 'App', units: [unit,
    {...unit, project: 'App', references: [{project: 'Lib', referenceOutputAssembly: true}]}]}, {compileUnit() {
    calls++;
    return {success: false, diagnostics: [{code: 'CS1002', severity: 'error', message: 'Missing semicolon'}], metrics: {errors: 1}};
  }});
  assert.equal(calls, 1);
  assert.equal(result.success, false);
  assert.equal(result.assembly, null);
  assert.equal(result.metrics.errors, 2);
});

test('a project built for two target contexts produces distinct dependency artifacts', () => {
  const library = {project: 'Library.csproj', assemblyName: 'Library', options: {}, sources: [], references: []};
  const app = {project: 'App.csproj', contextId: 'app-net10', assemblyName: 'App', options: {}, sources: [],
    references: [{project: 'Library.csproj', contextId: 'library-net10', output: 'net10/Library.dll'}]};
  const plan = {startup: app.project, startupContextId: app.contextId, units: [
    {...library, contextId: 'library-net8', targetFramework: 'net8.0', output: 'net8/Library.dll'},
    {...library, contextId: 'library-net10', targetFramework: 'net10.0', output: 'net10/Library.dll'}, app]};
  const result = compileProjectPlan(plan, {compileUnit(unit, options) {
    if (unit.project === app.project) assert.deepEqual(options.references[0].bytes, Uint8Array.of(10));
    return {success: true, diagnostics: [], image: {}, assembly: Uint8Array.of(unit.targetFramework === 'net8.0' ? 8 : 10),
      metrics: {errors: 0}};
  }});
  assert.equal(result.success, true);
  assert.deepEqual(result.projectArtifacts.map(unit => unit.contextId), ['library-net8', 'library-net10', 'app-net10']);
  assert.throws(() => compileProjectPlan({...plan, units: [plan.units[0], {...plan.units[1], contextId: 'library-net8'}, app]}),
    /Duplicate or invalid project context/);
});

test('standalone worker builds handle a cold artifact cache and retain the subsequent cached assembly', () => {
  const workspace = new Workspace();
  workspace.update('Program.cs', 'System.Console.WriteLine(42);', 1);
  const handler = createCompilationHandler(workspace);
  const first = handler({assemblyName: 'CacheFixture'}, 'build');
  assert.equal(first.success, true, JSON.stringify(first.diagnostics));
  assert.ok(first.assembly instanceof Uint8Array);
  const second = handler({assemblyName: 'CacheFixture'}, 'build');
  assert.equal(second.success, true);
  assert.equal(second.metrics.assemblyCached, true);
  assert.deepEqual(second.assembly, first.assembly);
});

test('application file search delegates options to the streaming disk index without compiling the workspace', async () => {
  const signal = new AbortController().signal;
  const state = {disk: {findInFiles(query, options) {
    assert.equal(query, 'Needle');
    assert.deepEqual(options, {matchCase: true, wholeWord: false, signal});
    return {matches: [{uri: 'Lazy.cs', start: 3, end: 9}], truncated: false};
  }}};
  const result = await requestProjectCompilation(state, {request() { assert.fail('No compiler request was needed'); }},
    'findInFiles', {query: 'Needle', options: {matchCase: true, wholeWord: false}, signal});
  assert.equal(result.matches[0].uri, 'Lazy.cs');
});

test('culture resources produce satellite assemblies instead of disappearing from successful builds', async () => {
  const state = workspaceState([{path: 'App/App.csproj', text: project()}, {path: 'App/Program.cs', text: 'Console.WriteLine(42);'}]);
  const request = await prepareProjectRequest(state, 'build');
  request.buildPlan.units[0].resources = [{manifestName: 'App.Messages.fr.resources', culture: 'fr', bytes: Uint8Array.of(1, 2, 3)}];
  const result = compileProjectPlan(request.buildPlan);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  const satellite = result.projectArtifacts[0].satellites[0];
  assert.ok(satellite.output.endsWith('/fr/App.resources.dll'));
  const pe = readPE(satellite.assembly);
  assert.equal(pe.metadata.string(pe.metadata.rows[32][0][8]), 'fr');
  assert.equal(pe.metadata.string(pe.metadata.rows[40][0][2]), 'App.Messages.fr.resources');
  assert.equal(readPE(result.assembly).metadata.rows[40]?.length ?? 0, 0);
});

test('launch profiles carry explicit browser arguments and environment; executable profiles require native execution', () => {
  const state = workspaceState([{path: 'App/App.csproj', text: project()}, {path: 'App/Program.cs', text: 'Console.WriteLine(1);'},
    {path: 'App/Properties/launchSettings.json', text: JSON.stringify({profiles: {
      Local: {commandName: 'Project', commandLineArgs: 'one "two words"', environmentVariables: {MODE: 'profile'}},
      External: {commandName: 'Executable', executablePath: 'tool'},
    }})}]);
  state.launchProfile = 'Local';
  const options = projectLaunchOptions(state, {environment: {EXTRA: 'caller'}});
  assert.deepEqual(options.args, ['one', 'two words']);
  assert.deepEqual(options.environment, {MODE: 'profile', EXTRA: 'caller'});
  state.launchProfile = 'External';
  assert.throws(() => projectLaunchOptions(state), /native MSBuild host/);
});

test('lazy export and cancelled or stale hydration never substitute empty file contents', async () => {
  const lazy = {path: 'opaque.bin', lazy: true};
  await assert.rejects(hydrateWorkspaceRecords({records: [lazy]}), /bytes are unavailable/);
  let reads = 0;
  const disk = {load: async path => { reads++; return {path, bytes: Uint8Array.of(0, 255)}; }};
  await assert.rejects(hydrateWorkspaceRecords({records: [lazy], disk}, {signal: AbortSignal.abort()}), {name: 'AbortError'});
  assert.equal(reads, 0);
  assert.deepEqual((await hydrateWorkspaceRecords({records: [lazy], disk}))[0].bytes, Uint8Array.of(0, 255));
  const state = workspaceState([{path: 'App/App.csproj', text: project()}, {path: 'App/A.cs', lazy: true, size: 10}]);
  state.disk = {load: async path => { state.revision++; return {path, text: 'changed'}; }};
  await assert.rejects(prepareProjectRequest(state, 'build'), /Workspace changed/);
});
