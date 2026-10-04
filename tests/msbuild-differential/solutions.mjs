import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeWorkspace, NativeMSBuild} from '@sharpforge/msbuild/node';
import {ProjectSystem} from '@sharpforge/project-system';
import {readSlnxConfigurations, readSlnConfigurations, selectSolutionProjects, writeLegacySolution,
  solutionProjectBuildRequest} from '@sharpforge/msbuild';

const projectSource = `<Project DefaultTargets="Build">
  <Target Name="Restore" />
  <Target Name="Build"><WriteLinesToFile File="$(MSBuildProjectFullPath).observed" Overwrite="true"
    Lines="$(Configuration)|$(Platform)" /></Target>
</Project>`;

const fixtures = [
  {id: 'default-clr', source: '<Solution><Project Path="App.csproj"/></Solution>'},
  {id: 'mixed-defaults', source: '<Solution><Project Path="App.csproj"/><Project Path="Native.vcxproj"/></Solution>'},
  {id: 'explicit-rules', source: `<Solution><Configurations><BuildType Name="Debug"/><BuildType Name="Release"/>
    <Platform Name="Any CPU"/><Platform Name="x64"/></Configurations>
    <Project Path="App.csproj"><BuildType Solution="Release|*" Project="Production"/>
      <Platform Solution="*|x64" Project="x64"/><Build Solution="Debug|x64" Project="false"/></Project>
    <Project Path="Other.csproj"/></Solution>`}
];

/** Build real .slnx and serialized .sln files and compare each observed project's globals/participation with the mapping model. */
export async function qualifyNativeSolutionMappings(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-solution-parity-'));
  let engine;
  const cases = [];
  try {
    if (options.sdkVersion) await writeFile(join(root, 'global.json'), JSON.stringify({sdk: {version: options.sdkVersion, rollForward: 'disable'}}));
    const workspace = await NativeWorkspace.open(root);
    engine = new NativeMSBuild(workspace, {trusted: true, executable: options.executable ?? 'dotnet'});
    const probe = await engine.probe();
    for (const fixture of fixtures) {
      const model = readSlnxConfigurations(fixture.source);
      const legacy = writeLegacySolution(model);
      const read = readSlnConfigurations(legacy);
      const again = readSlnConfigurations(writeLegacySolution(read));
      if (JSON.stringify(read.projects.map(project => project.id)) !== JSON.stringify(again.projects.map(project => project.id))) {
        throw new Error('Serialized solution changed existing project GUIDs');
      }
      for (const extension of ['slnx', 'sln']) for (const configuration of model.configurations) {
        const directory = fixture.id + '-' + extension + '-' + configuration.name.replaceAll(/[^A-Za-z0-9]/g, '_');
        const path = directory + '/Fixture.' + extension;
        await mkdir(join(root, directory), {recursive: true});
        await writeFile(join(root, path), extension === 'slnx' ? fixture.source : legacy);
        for (const project of model.projects) {
          await mkdir(dirname(join(root, directory, project.path)), {recursive: true});
          await writeFile(join(root, directory, project.path), projectSource);
        }
        const selected = selectSolutionProjects(extension === 'slnx' ? model : read, configuration);
        const args = ['build', path, '--no-restore', '-nologo', '-m:1', '-nodeReuse:false', '-verbosity:quiet',
          '-p:Configuration=' + configuration.configuration,
          '-p:Platform=' + configuration.platform, '-p:NuGetAudit=false'];
        const output = await engine.runTool({project: path, arguments: args, trusted: true, timeoutMs: 30_000});
        const observed = [];
        for (const project of selected.projects) {
          let actual = null;
          try { actual = (await readFile(join(root, directory, project.path + '.observed'), 'utf8')).trim(); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          const expected = project.selected ? project.configuration + '|' + project.platform : null;
          observed.push({project: project.path, expected, actual, equal: actual === expected});
        }
        cases.push({id: directory, command: [engine.executable, ...args], exitCode: output.exitCode,
          stdout: output.stdout, stderr: output.stderr, observed,
          success: output.exitCode === 0 && observed.every(value => value.equal)});
      }
      const mapped = solutionProjectBuildRequest(model, {project: model.projects[0].path, configuration: 'Release', platform: 'Any CPU'});
      const selection = selectSolutionProjects(model, {configuration: 'Release', platform: 'Any CPU'});
      const files = model.projects.filter(project => project.path.endsWith('.csproj')).map(project =>
        ({path: project.path, text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
          + '<TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>'}));
      files.push({path: 'Fixture.slnx', text: fixture.source});
      const portable = new ProjectSystem(files, {projectProperties: selection.projectProperties}).load('Fixture.slnx');
      const first = portable.projects.find(project => project.path === mapped.project);
      cases.push({id: fixture.id + '-project-context', configuration: mapped.configuration, platform: mapped.platform,
        portableConfiguration: first.effectiveConfiguration, portablePlatform: first.effectivePlatform,
        success: first.effectiveConfiguration === mapped.configuration && first.effectivePlatform === mapped.platform});
      const directory = fixture.id + '-single-project';
      const path = directory + '/' + mapped.project;
      await mkdir(dirname(join(root, path)), {recursive: true});
      await writeFile(join(root, path), projectSource);
      const args = ['build', path, '--no-restore', '-nologo', '-m:1', '-nodeReuse:false', '-verbosity:quiet',
        '-p:Configuration=' + mapped.configuration, '-p:Platform=' + mapped.platform];
      const output = await engine.runTool({project: path, arguments: args, trusted: true, timeoutMs: 30_000});
      const actual = output.exitCode === 0 ? (await readFile(join(root, path + '.observed'), 'utf8')).trim() : null;
      cases.push({id: directory, command: [engine.executable, ...args], exitCode: output.exitCode, actual,
        expected: mapped.configuration + '|' + mapped.platform,
        success: output.exitCode === 0 && actual === mapped.configuration + '|' + mapped.platform});
    }
    return {schemaVersion: 1, reference: {sdk: options.sdkVersion, msbuild: probe.version, node: process.version,
      platform: process.platform}, cases, success: cases.every(value => value.success)};
  } finally { await engine?.close(); await rm(root, {recursive: true, force: true}); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const report = await qualifyNativeSolutionMappings({executable: process.env.SHARPFORGE_DOTNET ?? 'dotnet', sdkVersion: process.env.SHARPFORGE_SDK});
  const text = JSON.stringify(report, null, 2) + '\n';
  const output = process.argv.indexOf('--output');
  if (output >= 0) await writeFile(process.argv[output + 1], text);
  else process.stdout.write(text);
  if (!report.success) process.exitCode = 1;
}
