async () => {
  const {MSBuildTools} = await import('/msbuild-tools.js');
  const {createNativeContextHooks} = await import('/native-build/workspace-state.js');
  const {createProjectContext, createTestCase, createTestResult} = await import('/packages/msbuild/src/index.js');
  const source = `using Xunit;
public class BrowserTests {
  static int count;
  [Fact] public void Good() { count++; Assert.Equal(1, count); }
  [Fact] public void Bad() { Assert.True(false); }
  [Fact(Skip="planned")] public void Skipped() { Assert.True(false); }
}`;
  const files = new Map([
    ['App/App.csproj', '<Project Sdk="Microsoft.NET.Sdk"/>'], ['App/Tests.cs', source],
    ['App/Properties/launchSettings.json', JSON.stringify({profiles: {
      Local: {commandName: 'Project', commandLineArgs: 'first "two words"', workingDirectory: 'work',
        environmentVariables: {MODE: 'browser-check'}, applicationUrl: 'http://localhost:8181'}
    }})]
  ]);
  const state = {nativeMode: false, name: 'Browser', files: [], tabs: [], active: '', revision: 1};
  const calls = [];
  const errors = [];
  const opened = [];
  const downloaded = [];
  const contexts = ['net8.0', 'net10.0'].map(targetFramework => createProjectContext({project: 'App/App.csproj',
    targetFramework, configuration: 'Debug', platform: 'AnyCPU', langVersion: '12', nullable: 'enable', backend: 'native',
    sources: [{path: 'App/Tests.cs'}], references: [], defines: [targetFramework === 'net8.0' ? 'NET8_0' : 'NET10_0'],
    generatedSources: [{path: 'App/obj/' + targetFramework + '/GlobalUsings.g.cs', text: 'global using System;',
      generated: true, readOnly: true}]}));
  const host = document.createElement('section');
  host.id = 'native-ui-fixture';
  Object.assign(host.style, {position: 'fixed', inset: '10px', zIndex: '30000', background: '#20242c', color: '#f0f0f0',
    overflow: 'auto', padding: '20px'});
  document.body.append(host);
  const panels = new Map(['msbuild', 'tests', 'project-source', 'msbuild-inspector'].map(name => {
    const element = document.createElement('div');
    element.dataset.fixturePanel = name;
    element.hidden = name !== 'msbuild';
    host.append(element);
    return [name, element];
  }));
  let ui;
  const selectPanel = name => { for (const [id, panel] of panels) panel.hidden = id !== name; ui.render(name, panels.get(name)); };
  ui = new MSBuildTools({...createNativeContextHooks({state}), onAttach: () => { state.nativeMode = true; },
    getSourceChanges: () => [], getTestProject: () => 'App/App.csproj', onError: error => errors.push(error.message),
    onSelectPanel: selectPanel, onOpenSource: (file, line) => opened.push({path: file.path, line}),
    onOpenTestSource: source => opened.push(source), download: (bytes, path) => downloaded.push({size: bytes.length, path})});
  const workspace = {root: '/fixture', name: 'Native transport fixture', projects: ['App/App.csproj'], solutions: [],
    files: [...files.keys()].map(path => ({path, kind: path.endsWith('.cs') ? 'source' : 'project'}))};
  let discovery = [];
  let cancelled = false;
  let slow = false;
  let run = null;
  const client = {
    connect: async () => ({protocolVersion: 1, trusted: true, available: true, version: 'UI TRANSPORT FIXTURE'}),
    workspace: async () => workspace,
    read: async path => ({path, text: files.get(path), hash: 'loaded'}),
    save: async () => ({written: []}),
    projectContexts: async request => { calls.push({kind: 'contexts', request}); return contexts; },
    projectMetadata: async request => { calls.push({kind: 'metadata', request}); return {
      contextId: contexts.find(context => context.targetFramework === request.framework).id, references: [], totalBytes: 0}; },
    publishProfiles: async request => { calls.push({kind: 'profiles', request}); return [{name: 'Folder',
      path: 'App/Properties/PublishProfiles/Folder.pubxml', properties: {PublishDir: {value: 'publish', evaluated: true}}, diagnostics: []}]; },
    runProject: async request => { calls.push({kind: 'run', request}); return {exitCode: 0, stdout: 'native transport output', stderr: ''}; },
    publishProfile: async request => { calls.push({kind: 'publish', request}); return {id: 'publish', request, status: 'succeeded',
      exitCode: 0, diagnostics: [], artifacts: [], events: [], nextCursor: 0, invocation: {}, result: null}; },
    async service(scope, operation, request) {
      calls.push({kind: 'testing', operation, request});
      if (operation === 'discover') {
        discovery = request.sourceTests?.length ? request.sourceTests : [createTestCase({project: request.project, fqn: 'BrowserTests.Good'})];
        return {tests: discovery, diagnostics: [], output: {stdout: 'native discovery transport fixture'}};
      }
      if (operation === 'start') { cancelled = false; run = request; return {id: 'native-tests'}; }
      if (operation === 'cancel') { cancelled = true; return {state: 'cancelling'}; }
      if (operation === 'artifact') return {path: request.path, base64: 'AQID'};
      const result = {id: 'native-tests', state: cancelled ? 'cancelled' : 'completed', success: !cancelled,
        results: run.tests.map(test => createTestResult(test, {outcome: cancelled ? 'not-run' : 'passed', backend: 'native-vstest'})),
        diagnostics: [], artifacts: [{path: '.sharpforge/msbuild/native-tests/results.trx', size: 3}],
        coverage: [{format: 'cobertura', coveredLines: 1, totalLines: 2,
          files: [{path: 'App/Tests.cs', lines: [{number: 4, hits: 1, coveredBranches: 1, totalBranches: 2},
            {number: 5, hits: 0, coveredBranches: 0, totalBranches: 0}]}]}]};
      return {id: 'native-tests', state: slow && !cancelled ? 'running' : result.state, nextCursor: 1,
        events: request.after ? [] : [{sequence: 1, kind: 'debugger-handoff', pid: 42,
          protocol: 'managed-testhost', waitingForDebugger: true}], result: slow && !cancelled ? null : result};
    },
    disconnect() {}
  };
  await ui.connect(client);
  ui.render('msbuild', panels.get('msbuild'));
  ui.render('tests', panels.get('tests'));
  window.__nativeUi = {ui, state, calls, errors, opened, downloaded, contexts, selectPanel,
    setSlow: value => { slow = value; }, async close() { await ui.dispose(); host.remove(); }};
}
