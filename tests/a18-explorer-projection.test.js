import test from 'node:test';
import assert from 'node:assert/strict';
import {TreeModel} from '../packages/controls/src/index.js';
import {buildSolutionTree} from '../packages/project-system/src/index.js';
import {SolutionExplorer} from '../apps/studio/solution-explorer.js';
import {SolutionExplorerProjection} from '../apps/studio/solution-explorer-projection.js';

function sourceWorkspace(count = 4) {
  return {
    identity: 'preview:explorer-projection', name: 'Example', active: 'A.cs',
    files: [{uri: 'A.cs', text: 'class Example {}', version: 1}, {uri: 'B.cs', text: 'class B {}'}],
    dirty: [], folders: ['Empty'], generated: [],
    symbols: [
      {id: 'A.cs:6:class', uri: 'A.cs', name: 'Example', kind: 'class', start: 6, end: 13},
      ...Array.from({length: count}, (_, index) => ({
        id: `A.cs:${30 + index * 20}:method`, uri: 'A.cs', name: 'Method' + index,
        owner: 'Example', kind: 'method', type: 'int', parameters: [],
        start: 30 + index * 20, end: 38 + index * 20
      }))
    ]
  };
}

function harness() {
  const model = new TreeModel();
  let builds = 0;
  const projection = new SolutionExplorerProjection(model, {
    buildTree(data) { builds++; return buildSolutionTree(data); }
  });
  return {model, projection, get builds() { return builds; }};
}

function sourceNode(model, path = 'A.cs') {
  return [...model.nodes.values()].find(node => node.kind === 'source' && node.path === path);
}

function symbolNode(model, name) {
  return [...model.nodes.values()].find(node => node.symbol?.name === name);
}

function sameAsFresh(model, data, options = {}) {
  const reference = new TreeModel(buildSolutionTree({...data, ...options}));
  assert.deepEqual(model.roots, reference.roots);
}

test('3000 accepted symbols reuse sort and index across typing while selection, expansion and filtering survive', () => {
  const data = sourceWorkspace(3000), host = harness();
  host.projection.update(data);
  const file = sourceNode(host.model), type = symbolNode(host.model, 'Example');
  const selected = symbolNode(host.model, 'Method2500');
  host.model.expand(file.id);
  host.model.expand(type.id);
  host.model.setFilter('Method2500');
  host.model.select(selected.id);
  const roots = host.model.roots, nodes = host.model.nodes;
  const state = host.model.snapshot(), revision = host.model.revision;

  for (let version = 2; version <= 8; version++) {
    const result = host.projection.update({...data, revision: version,
      files: data.files.map(file => ({...file, text: file.text + ' '.repeat(version), version})),
      dirty: ['A.cs'], tabs: ['A.cs', 'B.cs'], active: 'A.cs'});
    assert.equal(result.rebuilt, false);
  }

  assert.equal(host.builds, 1);
  assert.equal(host.model.roots, roots);
  assert.equal(host.model.nodes, nodes);
  assert.equal(sourceNode(host.model), file);
  assert.equal(symbolNode(host.model, 'Method2500'), selected);
  assert.equal([...host.model.nodes.values()].filter(node => node.kind === 'symbol').length, 3001);
  assert.equal(file.dirty, true);
  assert.equal(host.model.revision, revision + 1, 'the first dirty transition sends one view update');
  assert.equal(host.model.query, 'method2500');
  assert.deepEqual(host.model.snapshot(), state);
  assert.equal(host.model.rows().find(row => row.match).node, selected);
});

test('same-identity analysis refreshes navigation spans and metadata without replacing visible nodes', () => {
  const data = sourceWorkspace(), host = harness();
  host.projection.update(data);
  const method = symbolNode(host.model, 'Method2');
  host.model.reveal(method.id);
  const revision = host.model.revision;
  const symbols = data.symbols.map(symbol => ({...symbol,
    start: symbol.start + 10, end: symbol.end + 10, description: 'latest accepted analysis'}));

  host.projection.update({...data, symbols});

  assert.equal(host.builds, 1);
  assert.equal(symbolNode(host.model, 'Method2'), method);
  assert.equal(host.model.nodes.get(host.model.focused).start, symbols[3].start);
  assert.equal(host.model.nodes.get(host.model.focused).end, symbols[3].end);
  assert.equal(method.symbol, symbols[3]);
  assert.equal(method.symbol.description, 'latest accepted analysis');
  assert.equal(host.model.revision, revision);
  symbols[3].start += 7;
  symbols[3].end += 7;
  host.projection.update({...data, symbols});
  assert.equal(method.start, symbols[3].start, 'in-place span changes also refresh the navigation target');
  sameAsFresh(host.model, {...data, symbols});
});

test('changed compiler identities retain the ordered nodes and unchanged file state', () => {
  const data = sourceWorkspace(), host = harness();
  host.projection.update(data);
  const file = sourceNode(host.model);
  host.model.expand(file.id);
  host.model.select(file.id);
  const symbols = data.symbols.map(symbol => ({...symbol,
    id: `${symbol.uri}:${symbol.start + 5}:${symbol.kind}`, start: symbol.start + 5, end: symbol.end + 5}));

  host.projection.update({...data, symbols});

  assert.equal(host.builds, 1);
  assert.equal(sourceNode(host.model), file);
  assert(host.model.expanded.has(file.id));
  assert(host.model.selected.has(file.id));
  assert.equal(symbolNode(host.model, 'Method2').symbol, symbols[3]);
  assert(symbolNode(host.model, 'Method2').id.endsWith(':symbol:' + symbols[3].id));
  sameAsFresh(host.model, {...data, symbols});
});

test('mutable symbol display changes invalidate labels, nesting, filtering and the declaration set', () => {
  const data = sourceWorkspace(), host = harness();
  host.projection.update(data);
  const changes = [
    () => { data.symbols[2].name = 'Renamed'; },
    () => { data.symbols[2].parameters.push({name: 'value', type: 'string'}); },
    () => { data.symbols[2].parameters[0].type = 'int'; },
    () => { data.symbols[2].owner = 'Other'; },
    () => { data.symbols[2].type = 'string'; },
    () => { data.symbols[2].kind = 'property'; },
    () => { data.symbols[2].uri = 'B.cs'; },
    () => { data.symbols.pop(); },
    () => { data.symbols.push({id: 'B.cs:12:field', uri: 'B.cs', kind: 'field', name: 'Added', type: 'int'}); }
  ];
  host.model.setFilter('Renamed');
  for (const change of changes) {
    const builds = host.builds;
    change();
    assert.equal(host.projection.update(data).rebuilt, true);
    assert.equal(host.builds, builds + 1);
    assert.equal(host.model.query, 'renamed');
    sameAsFresh(host.model, data);
  }
});

function projectWorkspace() {
  const data = sourceWorkspace();
  data.files.push({path: 'App/Hidden.cs'}, {path: 'notes.txt'});
  data.snapshot = {
    solution: {path: 'Example.slnx', name: 'Example', items: [
      {kind: 'project', path: 'App/App.csproj', folder: '/src/'},
      {kind: 'project', path: 'Other/Other.csproj', folder: '/src/'}
    ]},
    projects: [
      {path: 'App/App.csproj', name: 'App', compile: [{path: 'A.cs', metadata: {Link: 'Shared/A.cs'}}],
        packageReferences: [{name: 'Pkg', version: '1.0'}], targetFramework: 'net10.0'},
      {path: 'Other/Other.csproj', name: 'Other', compile: [{path: 'A.cs', metadata: {Link: 'A.cs'}}]}
    ]
  };
  return data;
}

test('dirty markers update every linked file appearance and clear without rebuilding the hierarchy', () => {
  const data = projectWorkspace(), host = harness();
  host.projection.update(data);
  const appearances = [...host.model.nodes.values()].filter(node => node.kind === 'source' && node.path === 'A.cs');
  assert.equal(appearances.length, 2);
  const revision = host.model.revision;

  host.projection.update({...data, dirty: ['A.cs', 'App/App.csproj']});
  assert(appearances.every(node => node.dirty));
  assert.equal(host.model.nodes.get('project:App/App.csproj:xml').dirty, true);
  host.projection.update({...data, dirty: ['App/App.csproj', 'A.cs', 'A.cs']});
  assert.equal(host.model.revision, revision + 1);
  host.projection.update({...data, dirty: []});

  assert(appearances.every(node => !node.dirty));
  assert.equal(host.model.nodes.get('project:App/App.csproj:xml').dirty, false);
  assert.equal(host.builds, 1);
  assert.equal(host.model.revision, revision + 2);
  sameAsFresh(host.model, data);
});

test('file, project, link, dependency, generated and workspace changes match a freshly built hierarchy', () => {
  const data = projectWorkspace(), host = harness();
  host.projection.update(data);
  const changes = [
    () => { data.files.push({path: 'App/info.json'}); },
    () => { data.files.at(-1).kind = 'assembly'; },
    () => { data.files.at(-1).path = 'App/renamed.json'; },
    () => { data.files.pop(); },
    () => { data.snapshot.projects[0].compile.push({path: 'App/Hidden.cs'}); },
    () => { data.snapshot.projects[0].compile[0].metadata.Link = 'Moved/A.cs'; },
    () => { data.snapshot.projects[0].packageReferences[0].version = '2.0'; },
    () => { data.snapshot.projects[0].name = 'Renamed App'; },
    () => { data.startup = 'Other/Other.csproj'; },
    () => { data.snapshot.solution.items[0].folder = '/different/'; },
    () => { data.folders.push('App/Empty'); },
    () => { data.generated.push({uri: 'generated/One.g.cs', text: 'class One {}'}); },
    () => { data.generated[0].uri = 'generated/Two.g.cs'; },
    () => { data.snapshot.projects.pop(); data.snapshot.solution.items.pop(); },
    () => { data.identity = 'preview:another-workspace'; },
    () => { data.name = 'Another workspace'; }
  ];
  for (const change of changes) {
    const builds = host.builds;
    change();
    assert.equal(host.projection.update(data).rebuilt, true);
    assert.equal(host.builds, builds + 1);
    sameAsFresh(host.model, data);
  }
  const builds = host.builds;
  data.generated[0].text = 'class Two { int Changed; }';
  assert.equal(host.projection.update(data).rebuilt, false);
  assert.equal(host.builds, builds, 'generated contents do not alter the displayed generated file list');
});

test('show-all, folder view, scope removal and explicit refresh invalidate the correct projection', () => {
  const data = projectWorkspace(), host = harness();
  host.projection.update(data);
  host.projection.update(data, {showAll: true});
  sameAsFresh(host.model, data, {showAll: true});
  host.projection.update(data, {view: 'folders'});
  sameAsFresh(host.model, data, {view: 'folders'});
  const file = sourceNode(host.model);
  const scoped = host.projection.update(data, {view: 'folders', scope: file.id});
  assert.equal(scoped.scope, file.id);
  assert.equal(host.model.roots[0].id, file.id);
  assert.equal(host.model.roots.length, 1);

  data.files = data.files.filter(value => (value.path ?? value.uri) !== 'A.cs');
  const removed = host.projection.update(data, {view: 'folders', scope: file.id});
  assert.equal(removed.scope, null);
  sameAsFresh(host.model, data, {view: 'folders'});
  const builds = host.builds;
  assert.equal(host.projection.update(data, {view: 'folders'}).rebuilt, false);
  host.projection.update(data, {view: 'folders', force: true});
  assert.equal(host.builds, builds + 1);
});

test('a rejected candidate leaves the indexed nodes, navigation locations and reusable cache intact', () => {
  const data = sourceWorkspace(), host = harness();
  host.projection.update(data);
  const method = symbolNode(host.model, 'Method0');
  host.model.reveal(method.id);
  const roots = host.model.roots, nodes = host.model.nodes, state = host.model.snapshot();
  const symbols = data.symbols.map(symbol => ({...symbol, start: symbol.start + 20, end: symbol.end + 20}));
  symbols[2].id = symbols[1].id;

  assert.throws(() => host.projection.update({...data, symbols, dirty: ['A.cs']}), /unique/);

  assert.equal(host.model.roots, roots);
  assert.equal(host.model.nodes, nodes);
  assert.deepEqual(host.model.snapshot(), state);
  assert.equal(method.symbol, data.symbols[1]);
  assert.equal(method.start, data.symbols[1].start);
  assert.equal(sourceNode(host.model).dirty, false);
  assert.equal(host.projection.update(data).rebuilt, false);
  assert.equal(host.builds, 1, 'the rejected identity update does not displace the last accepted cache');
});

function attributeElement() {
  const attributes = new Map();
  return {
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    focus() {}
  };
}

test('the real explorer render delegation preserves controls, active navigation and workspace reset on reuse', () => {
  let data = sourceWorkspace();
  const host = harness(), add = {disabled: false}, reveals = [];
  const explorer = {
    model: host.model, projection: host.projection, key: data.identity,
    getData: () => data, showAll: false, view: 'solution', scope: null, track: true,
    tree: attributeElement(), allButton: attributeElement(), viewButton: attributeElement(),
    toolbar: {querySelector: () => add}, search: {value: ''},
    control: {ensureVisible() {}}, onProperties: nodes => reveals.push(nodes[0].path),
    updateCaption() {}, saveState() {}, reveal: SolutionExplorer.prototype.reveal
  };
  SolutionExplorer.prototype.render.call(explorer);
  const first = sourceNode(host.model), nodes = host.model.nodes;
  explorer.search.value = 'Method2';
  data = {...data, fileBusy: true};
  SolutionExplorer.prototype.render.call(explorer);
  assert.equal(host.model.nodes, nodes);
  assert.equal(host.model.query, 'method2');
  assert.equal(explorer.tree.getAttribute('aria-busy'), 'true');
  assert.equal(add.disabled, true);

  data = {...data, fileBusy: false, readOnly: true, active: 'B.cs'};
  SolutionExplorer.prototype.render.call(explorer);
  assert.equal(host.model.nodes, nodes);
  assert.equal(host.model.query, '');
  assert.deepEqual(reveals, ['A.cs', 'B.cs']);
  assert.equal(host.model.nodes.get(host.model.focused).path, 'B.cs');
  assert.equal(add.disabled, true);
  explorer.track = false;
  data = {...data, readOnly: false, active: 'A.cs'};
  SolutionExplorer.prototype.render.call(explorer);
  assert.equal(add.disabled, false);
  assert.deepEqual(reveals, ['A.cs', 'B.cs']);

  explorer.scope = first.id;
  data = {...data, identity: 'preview:replacement-workspace', mode: 'folder'};
  SolutionExplorer.prototype.render.call(explorer);
  assert.equal(explorer.scope, null);
  assert.equal(explorer.view, 'folders');
  assert.equal(explorer.track, true);
  assert.equal(explorer.restoring, false);
  assert.notEqual(host.model.nodes, nodes);
  assert.equal(host.model.selected.size, 0);
});
