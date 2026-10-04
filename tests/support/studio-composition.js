import { ProjectSystem } from '../../packages/project-system/src/index.js';
import { EditorModel } from '../../packages/editor/src/index.js';
import { createWorkbenchServices } from '../../apps/studio/workbench/sessions.js';
import { StudioProjects } from '../../apps/studio/workbench/studio-projects.js';
import { fakeWorkers, fakeRuntime, compileResult } from '../a19-session-fixtures.js';

export function studioComposition(respond = message => message.method === 'build' ? compileResult() : { ok: true }) {
  const project = (reference = '') => '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>'
    + '</PropertyGroup>' + reference + '</Project>';
  const records = [
    { path: 'TwoApps.slnx', text: '<Solution><Project Path="Alpha/Alpha.csproj"/><Project Path="Beta/Beta.csproj"/></Solution>' },
    { path: 'Alpha/Alpha.csproj', text: project('<ItemGroup><Compile Include="../Shared.cs"/></ItemGroup>') },
    { path: 'Beta/Beta.csproj', text: project('<ItemGroup><Compile Include="../Shared.cs"/></ItemGroup>') },
    { path: 'Alpha/Program.cs', text: 'System.Console.WriteLine("alpha");' },
    { path: 'Beta/Program.cs', text: 'System.Console.WriteLine("beta");' },
    { path: 'Shared.cs', text: 'class Shared {}' }
  ];
  const system = new ProjectSystem(records);
  system.load('TwoApps.slnx');
  const fake = fakeWorkers((message, worker) => message.method === 'launch' || message.method === 'stop'
    ? fakeRuntime(message, worker) : respond(message, worker));
  let projects;
  const services = createWorkbenchServices({
    workerFactory: fake.factory,
    records: records.filter(record => record.path.endsWith('.cs')).map(record => ({ uri: record.path, text: record.text })),
    createModel: record => new EditorModel(record.text, { uri: record.uri, version: record.version }),
    getProjectSnapshot: id => projects.snapshot(id)
  });
  const state = {
    projectSystem: system, files: services.documents.files, startupProject: 'Alpha/Alpha.csproj',
    active: 'Alpha/Program.cs', name: 'TwoApps', langVersion: '14', configuration: 'Debug',
    workspaceEpoch: 1, breakpoints: {}, extraFiles: [], nativeMode: false, hotEdit: false
  };
  projects = new StudioProjects(services, { state: () => state });
  projects.sync();
  return { services, projects, state, records, fake, dispose: () => services.dispose() };
}
