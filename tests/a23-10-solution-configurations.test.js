import test from 'node:test';
import assert from 'node:assert/strict';
import {readSlnxConfigurations, mapSlnxProject} from '../packages/msbuild/src/solution-configurations.js';
import {readSlnConfigurations} from '../packages/msbuild/src/sln-configurations.js';
import {writeLegacySolution} from '../packages/msbuild/src/sln-writer.js';
import {selectSolutionProjects, solutionProjectBuildRequest, resolveSolutionBuildRequest} from '../packages/msbuild/src/solution-selection.js';
import {readLegacySolution} from '../packages/project-system/src/legacy-solution.js';
import {ProjectSystem} from '../packages/project-system/src/index.js';

const source = `<Solution><Configurations><BuildType Name="Debug"/><BuildType Name="Release"/>` +
  `<Platform Name="Any CPU"/><Platform Name="x64"/></Configurations><Folder Name="/src/">` +
  `<Project Path="App/App.csproj"><BuildType Solution="Release|*" Project="Production"/>` +
  `<Platform Solution="*|x64" Project="x64"/><Build Solution="Debug|x64" Project="false"/>` +
  `<Deploy Solution="Release|x64"/><BuildDependency Project="Native/Native.vcxproj"/></Project>` +
  `<Project Path="Native/Native.vcxproj"/><Project Path="Other/Other.fsproj"/></Folder></Solution>`;

test('A23 T10.1 default inference and last matching configuration rules map each project independently', () => {
  const model = readSlnxConfigurations(source);
  const debug = selectSolutionProjects(model, {configuration: 'Debug', platform: 'Any CPU'});
  assert.equal(debug.projects[0].configuration, 'Debug');
  assert.equal(debug.projects[0].platform, 'AnyCPU');
  assert.equal(debug.projects[1].platform, 'x64');
  assert.equal(debug.projects[2].platform, 'AnyCPU');
  const release = selectSolutionProjects(model, {configuration: 'Release', platform: 'x64', action: 'deploy'});
  assert.equal(release.projects[0].configuration, 'Production');
  assert.equal(release.projects[0].deploy, true);
  assert.equal(release.projects[0].selected, true);
  assert.equal(release.projects[1].selected, false);
  const excluded = selectSolutionProjects(model, {configuration: 'Debug', platform: 'x64'});
  assert.equal(excluded.projects[0].build, false);
  assert.deepEqual(excluded.projectProperties['App/App.csproj'], {Configuration: 'Debug', Platform: 'x64'});
});

test('A23 T10.3 default solution infers Debug/Release and CLR vs VC platform rules', () => {
  const model = readSlnxConfigurations('<Solution><Project Path="A.csproj"/><Project Path="B.vcxproj"/></Solution>');
  assert.deepEqual(model.configurations.map(value => value.name), ['Debug|Any CPU', 'Release|Any CPU']);
  assert.equal(mapSlnxProject(model.projects[1], {configuration: 'Debug', platform: 'x86'}).platform, 'Win32');
  assert.equal(selectSolutionProjects(model).projects[0].platform, 'AnyCPU');
});

test('A23 T10.1 custom type rules support inheritance and IsBuildable without overriding later project rules', () => {
  const model = readSlnxConfigurations('<Solution><Configurations>' +
    '<ProjectType Name="Base" Extension=".special" IsBuildable="false"><Platform Project="ARM64"/></ProjectType>' +
    '<ProjectType Name="Child" BasedOn="Base"><Build Project="true"/></ProjectType></Configurations>' +
    '<Project Path="A.special" Type="Child"><Platform Project="x64"/></Project></Solution>');
  const project = selectSolutionProjects(model).projects[0];
  assert.equal(project.platform, 'x64');
  assert.equal(project.build, true);
});

test('A23 T10.4 project requests and configuration-manager selection retain mapped globals', () => {
  const model = readSlnxConfigurations(source);
  const request = solutionProjectBuildRequest(model, {project: 'App/App.csproj', configuration: 'Release', platform: 'Any CPU'});
  assert.equal(request.configuration, 'Production');
  assert.equal(request.properties.Platform, 'AnyCPU');
  assert.throws(() => selectSolutionProjects(model, {configuration: 'Missing'}), /Unknown solution configuration/);
  assert.throws(() => solutionProjectBuildRequest(model, {project: 'Missing.csproj'}), /does not belong/);
});

test('A23 T10.4 saved solution context maps native project requests once, with cancellation and unknown-project errors', async () => {
  const workspace = {read: async () => ({text: source})};
  const request = {project: 'App/App.csproj', solution: 'Workspace.slnx', configuration: 'Release', platform: 'Any CPU'};
  const mapped = await resolveSolutionBuildRequest(workspace, request);
  assert.equal(mapped.configuration, 'Production');
  assert.equal(mapped.properties.Platform, 'AnyCPU');
  assert.equal(mapped.solutionConfiguration, 'Release');
  assert.deepEqual(await resolveSolutionBuildRequest(workspace, mapped), mapped);
  await assert.rejects(resolveSolutionBuildRequest(workspace, {...request, project: 'Missing.csproj'}), /does not belong/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(resolveSolutionBuildRequest(workspace, request, {signal: controller.signal}), {name: 'AbortError'});
});

test('A23 T10.2/T10.5 legacy writer preserves GUIDs, folders, dependencies, unsupported projects and Build.0 selection', () => {
  const model = readSlnxConfigurations(source);
  const text = writeLegacySolution(model);
  const read = readSlnConfigurations(text);
  assert.equal(read.projects.length, 3);
  assert.deepEqual(read.folders, ['/src/']);
  assert.equal(selectSolutionProjects(read, {configuration: 'Debug', platform: 'x64'}).projects[0].build, false);
  assert.equal(selectSolutionProjects(read, {configuration: 'Release', platform: 'x64'}).projects[0].deploy, true);
  const again = readSlnConfigurations(writeLegacySolution(read));
  assert.deepEqual(again.projects.map(project => project.id), read.projects.map(project => project.id));
  assert.deepEqual(again.projects.map(project => project.dependencies), read.projects.map(project => project.dependencies));
  assert.deepEqual(again.projects.map(project => project.configurations), read.projects.map(project => project.configurations));
  assert.equal(selectSolutionProjects(read, {configuration: 'Debug', platform: 'Any CPU'}).projects[0].platform, 'AnyCPU');
  const mixedCase = text.replaceAll('.Debug|Any CPU.ActiveCfg', '.debug|Any CPU.ACTIVECFG')
    .replaceAll('.Debug|Any CPU.Build.0', '.DEBUG|Any CPU.build.0');
  const mixed = selectSolutionProjects(readSlnConfigurations(mixedCase), {configuration: 'debug', platform: 'AnyCPU'});
  assert.equal(mixed.projects[0].platform, 'AnyCPU');
  assert.equal(mixed.projects[0].build, true);
});

test('A23 B05 unsupported project types remain visible and unloaded, never in portable compilation projectPaths', () => {
  const legacy = readLegacySolution(writeLegacySolution(readSlnxConfigurations(source)), 'Workspace.sln');
  assert.equal(legacy.name, 'Workspace');
  assert.deepEqual(legacy.projectPaths, ['App/App.csproj']);
  assert.deepEqual(legacy.projects.map(project => [project.path, project.unloaded]), [
    ['App/App.csproj', false], ['Native/Native.vcxproj', true], ['Other/Other.fsproj', true]
  ]);
  assert.equal(legacy.items.filter(item => item.kind === 'project').length, 3);
  assert.equal(legacy.diagnostics.filter(item => item.code === 'SFP1301').length, 2);
  const snapshot = new ProjectSystem([
    {path: 'Workspace.sln', text: writeLegacySolution(readSlnxConfigurations(source))},
    {path: 'App/App.csproj', text: '<Project><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>'}
  ]).load('Workspace.sln');
  assert.equal(snapshot.solution.name, 'Workspace');
  const unloaded = snapshot.projects.filter(project => project.unloaded);
  assert.deepEqual(unloaded.map(project => project.path), ['Native/Native.vcxproj', 'Other/Other.fsproj']);
  assert(unloaded.every(project => project.reason));
});

test('A23 T10 rejects malformed mappings, duplicate identities, limits and cancellation', () => {
  assert.throws(() => readSlnxConfigurations('<Solution><Project Path="A.csproj"><Build Project="yes"/></Project></Solution>'), /boolean/);
  assert.throws(() => readSlnxConfigurations('<Solution><Project Path="A.csproj"/><Project Path="a.csproj"/></Solution>'), /Duplicate/);
  assert.throws(() => readSlnxConfigurations('<Solution><Project Path="A.csproj"/></Solution>', {maxProjects: 0}), /limit/);
  assert.throws(() => readSlnxConfigurations('<Solution><Project Path="../../A.csproj"/></Solution>'));
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => readSlnxConfigurations(source, {signal: controller.signal}), {name: 'AbortError'});
});
