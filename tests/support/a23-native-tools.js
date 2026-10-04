import {createProjectContext} from '@sharpforge/msbuild';
import {MSBuildTools} from '../../apps/studio/msbuild-tools.js';
import {createNativeContextHooks} from '../../apps/studio/native-build/workspace-state.js';

export function nativeToolsFixture(options = {}) {
  const calls = [];
  const state = {nativeMode: false, name: 'Fixture', files: [], tabs: [], active: '', revision: 0};
  const files = new Map([
    ['App/App.csproj', '<Project Sdk="Microsoft.NET.Sdk"/>'], ['App/One.cs', 'class One {}'], ['App/Ten.cs', 'class Ten {}'],
    ['App/Properties/launchSettings.json', `{
      // File inspection must not run an SDK target.
      "profiles": {
        "Local": {"commandName":"Project", "commandLineArgs":"one \\\"two words\\\"", "workingDirectory":"work",
          "environmentVariables":{"MODE":"test"}, "applicationUrl":"http://localhost:8123",},
        "Tool": {"commandName":"Executable", "executablePath":"tool.exe"}
      }
    }`]
  ]);
  const contexts = ['net8.0', 'net10.0'].map((framework, index) => createProjectContext({project: 'App/App.csproj',
    configuration: 'Debug', platform: 'AnyCPU', targetFramework: framework, backend: 'native', outputKind: 'exe',
    defines: ['DEBUG', framework === 'net8.0' ? 'NET8_0' : 'NET10_0'], langVersion: '12.0', nullable: 'enable',
    unsafe: true, checked: true, references: [{path: '/sdk/Contract.dll', aliases: ['global']}],
    sources: [{path: index ? 'App/Ten.cs' : 'App/One.cs', readOnly: false}],
    generatedSources: [{path: 'App/obj/' + framework + '/GlobalUsings.g.cs', text: 'global using System;', generated: true, readOnly: true}],
    properties: {AssemblyName: 'Fixture', Configuration: 'Debug', TargetFramework: framework},
    diagnostics: index ? [{code: 'FIXTURE_INACTIVE', severity: 'warning', message: 'Inactive context diagnostic'}] : []}));
  const workspace = {root: '/fixture', name: 'Fixture', projects: ['App/App.csproj'], solutions: [],
    files: [...files.keys()].map(path => ({path, kind: path.endsWith('.cs') ? 'source' : 'project'}))};
  const completedJob = request => ({id: 'build-1', status: 'succeeded', request, exitCode: 0, events: [], nextCursor: 0,
    diagnostics: [], artifacts: [], invocation: {executable: 'fixture'}, result: null});
  const client = {
    async connect() { calls.push({kind: 'connect'}); return {protocolVersion: 1, available: true, trusted: true, version: 'Test transport'}; },
    async workspace() { return workspace; },
    async read(path) {
      calls.push({kind: 'read', path});
      if (!files.has(path)) throw Object.assign(new Error('No such file'), {status: 404});
      return {path, text: files.get(path), hash: 'hash:' + path};
    },
    async save(changes) { calls.push({kind: 'save', changes}); return {written: []}; },
    async projectContexts(request) { calls.push({kind: 'contexts', request}); return contexts; },
    async projectMetadata(request) {
      calls.push({kind: 'metadata', request});
      return {contextId: contexts.find(context => context.targetFramework === request.framework).id,
        references: [{path: '/sdk/Contract.dll', display: 'Contract.dll', aliases: ['global'], base64: 'AQID', size: 3}], totalBytes: 3};
    },
    async publishProfiles(request) {
      calls.push({kind: 'profiles', request});
      return [{name: 'Folder', path: 'App/Properties/PublishProfiles/Folder.pubxml', inspectionOnly: true,
        properties: {PublishDir: {value: 'publish', evaluated: true}, PublishTrimmed: {value: '$(Trim)', evaluated: false}}, diagnostics: []}];
    },
    async publishProfile(request) { calls.push({kind: 'publish', request}); return completedJob(request); },
    async runProject(request) { calls.push({kind: 'run', request}); return {exitCode: 0, stdout: 'native result', stderr: ''}; },
    async start(request) { calls.push({kind: 'start', request}); return completedJob(request); },
    async job() { return completedJob({action: 'build', project: 'App/App.csproj'}); },
    async cancel(id) { calls.push({kind: 'cancel', id}); return {...completedJob({action: 'build'}), status: 'cancelled'}; },
    disconnect() { calls.push({kind: 'disconnect'}); }
  };
  const tools = new MSBuildTools({onAttach: () => { state.nativeMode = true; }, ...createNativeContextHooks({state}),
    getSourceChanges: () => [], ...options});
  return {tools, client, state, files, contexts, calls, workspace};
}
