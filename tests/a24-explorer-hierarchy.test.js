import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSolutionTree, buildDependencyTree, buildSymbolChildren, remapExplorerState} from '../packages/project-system/src/index.js';
import {TreeModel} from '../packages/controls/src/index.js';
import {createProjectPlan} from '../packages/templates/src/index.js';
import {ProjectSystem} from '../packages/project-system/src/index.js';

function tree(options) { return new TreeModel(buildSolutionTree(options)); }

test('A24 evaluated Using items and empty Folder metadata do not become physical explorer paths', () => {
  const plan = createProjectPlan('console', {projectName: 'App', sameDirectory: true, useProgramMain: false,
    implicitUsings: true, solutionFormat: 'sln'});
  const snapshot = new ProjectSystem(plan.records).load(plan.entry);
  snapshot.projects[0].items.push({identity: 'System', itemType: 'Using', metadata: {}}, {itemType: 'Folder', metadata: {}});
  const model = tree({files: plan.records, snapshot});
  assert([...model.nodes.values()].some(node => node.kind === 'source'));
  assert.equal([...model.nodes.values()].some(node => node.path === 'System'), false);
});

test('A24 dependency identities survive display reorder and expose every target framework subtree', () => {
  const project = {path: 'App.csproj', targetFrameworks: ['net8.0', 'net10.0'], packageReferences: [
    {name: 'Alpha', version: '1.0'}, {name: 'Beta', version: '2.0', resolved: false}
  ], assetsGraph: {packages: [{name: 'Alpha', dependencies: [{name: 'Transitive', version: '3.0'}]}]}};
  const before = new TreeModel([buildDependencyTree(project, 'project:App.csproj')]);
  const ids = [...before.nodes.values()].filter(node => node.kind === 'package').map(node => node.id).sort();
  project.packageReferences.reverse();
  const after = new TreeModel([buildDependencyTree(project, 'project:App.csproj')]);
  assert.deepEqual([...after.nodes.values()].filter(node => node.kind === 'package').map(node => node.id).sort(), ids);
  assert.equal([...after.nodes.values()].filter(node => node.kind === 'target-framework').length, 2);
  assert.equal([...after.nodes.values()].filter(node => node.label === 'Transitive').length, 2);
  assert([...after.nodes.values()].some(node => node.label === 'Beta' && node.diagnostic && node.warning));
  assert([...after.nodes.values()].some(node => node.label === 'Frameworks'));
});

test('A24 default and DependentUpon nesting preserve node ids when the option is toggled', () => {
  const paths = ['App/MainWindow.xaml', 'App/MainWindow.xaml.cs', 'App/Foo.cs', 'App/Foo.Designer.cs',
    'App/appsettings.json', 'App/appsettings.Development.json', 'App/Part.cs'];
  const project = {path: 'App/App.csproj', compile: paths.filter(path => path.endsWith('.cs')).map(path =>
    ({path, metadata: path.endsWith('Part.cs') ? {DependentUpon: 'Foo.cs'} : {}}))};
  const options = {files: paths.map(path => ({path})), snapshot: {projects: [project]}};
  const nested = tree(options);
  const flat = tree({...options, nesting: false});
  for (const node of nested.nodes.values()) if (node.path) assert(flat.nodes.has(node.id));
  const codeBehind = [...nested.nodes.values()].find(node => node.path === 'App/MainWindow.xaml.cs');
  assert.equal(nested.nodes.get(nested.parents.get(codeBehind.id)).path, 'App/MainWindow.xaml');
  const partial = [...nested.nodes.values()].find(node => node.path === 'App/Part.cs');
  assert.equal(nested.nodes.get(nested.parents.get(partial.id)).path, 'App/Foo.cs');
});

test('A24 generated source and imports belong to their project and unsupported projects remain visible', () => {
  const snapshot = {projects: [{path: 'A.csproj', imports: ['Directory.Build.props'], generatedSources: [{path: 'obj/A.g.cs', generator: 'GenA'}]},
    {path: 'B.csproj', generatedSources: [{path: 'obj/B.g.cs', generator: 'GenB'}]}],
  solution: {path: 'Demo.sln', projects: [{path: 'C.vbproj', name: 'VisualBasic', supported: false, unloaded: true, reason: 'Native VB required'}]}};
  const model = tree({snapshot});
  for (const node of [...model.nodes.values()].filter(node => node.kind === 'generated')) {
    assert(model.ancestors(node.id).includes('project:' + node.project));
  }
  assert([...model.nodes.values()].some(node => node.kind === 'import' && node.path === 'Directory.Build.props'));
  assert.equal(model.nodes.get('project:C.vbproj').diagnostic.message, 'Native VB required');
});

test('A24 symbols materialize on expansion and include nested types, events and constructors', () => {
  const symbols = [
    {id: 'outer', uri: 'A.cs', kind: 'struct', name: 'Outer', start: 0, end: 100},
    {id: 'nested', uri: 'A.cs', kind: 'record', name: 'Nested', ownerId: 'outer', start: 20, end: 70},
    {id: 'event', uri: 'A.cs', kind: 'event', name: 'Changed', ownerId: 'nested', start: 30, end: 35},
    {id: 'ctor', uri: 'A.cs', kind: 'constructor', name: '.ctor', ownerId: 'outer', owner: 'Outer', start: 80, end: 90},
    {id: 'delegate', uri: 'A.cs', kind: 'delegate', name: 'Handler', start: 101, end: 120}
  ];
  const model = tree({files: [{path: 'A.cs'}], symbols});
  assert.equal([...model.nodes.values()].filter(node => node.kind === 'symbol').length, 0);
  const file = [...model.nodes.values()].find(node => node.kind === 'source');
  assert.equal(file.branch, true);
  const nodes = buildSymbolChildren(file, symbols);
  assert.equal(nodes.find(node => node.symbol.name === 'Outer').children.find(node => node.symbol.name === 'Nested').children[0].symbolKind, 'event');
  assert(nodes.some(node => node.symbolKind === 'delegate'));
  assert.equal(nodes.find(node => node.symbol.name === 'Outer').children.find(node => node.symbolKind === 'constructor').label, 'Outer()');
});

test('A24 rename maps selection, expansion and focused identity without following display order', () => {
  const before = tree({files: [{path: 'folder/A.cs'}]});
  const selected = [...before.nodes.values()].find(node => node.path === 'folder/A.cs');
  before.reveal(selected.id);
  const after = tree({files: [{path: 'folder/B.cs'}]});
  const state = remapExplorerState(before.snapshot(), before.nodes, after.nodes, [{from: 'folder/A.cs', to: 'folder/B.cs'}]);
  after.restore(state);
  assert.equal(after.nodes.get(after.focused).path, 'folder/B.cs');
  assert(after.selected.has(after.focused));
});
