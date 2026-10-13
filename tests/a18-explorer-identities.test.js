import test from 'node:test';
import assert from 'node:assert/strict';
import {TreeModel} from '../packages/controls/src/index.js';
import {buildSolutionTree} from '../packages/project-system/src/index.js';
import {SolutionExplorerProjection} from '../apps/studio/solution-explorer-projection.js';

function workspace(count = 3) {
  return {
    identity: 'preview:explorer-identities', name: 'Example', files: [{uri: 'A.cs', text: 'class Example {}'}],
    symbols: [
      {id: 'A.cs:6:class', uri: 'A.cs', kind: 'class', name: 'Example', start: 6, end: 13},
      ...Array.from({length: count}, (_, index) => ({
        id: `A.cs:${30 + index * 20}:method`, uri: 'A.cs', kind: 'method', owner: 'Example',
        name: 'Method' + index, type: 'int', parameters: [], start: 30 + index * 20, end: 38 + index * 20
      }))
    ]
  };
}

function shifted(data, delta = 2) {
  return {...data, symbols: data.symbols.map(symbol => ({...symbol,
    id: `${symbol.uri}:${symbol.start + delta}:${symbol.kind}`, start: symbol.start + delta, end: symbol.end + delta}))};
}

function harness(data) {
  const model = new TreeModel();
  let builds = 0;
  const projection = new SolutionExplorerProjection(model, {
    buildTree(value) { builds++; return buildSolutionTree(value); }
  });
  projection.update(data);
  return {model, projection, get builds() { return builds; }};
}

function symbolNode(model, name) {
  return [...model.nodes.values()].find(node => node.symbol?.name === name);
}

function assertFresh(model, data) {
  const reference = new TreeModel(buildSolutionTree(data));
  assert.deepEqual(model.roots, reference.roots);
  assert.deepEqual([...model.nodes.keys()], [...reference.nodes.keys()]);
  assert.deepEqual(model.parents, reference.parents);
}

test('3000 shifted declarations retain ordered nodes while public IDs, parents and UI state update once', () => {
  const data = workspace(3000), host = harness(data);
  const type = symbolNode(host.model, 'Example'), selected = symbolNode(host.model, 'Method2500');
  host.model.reveal(selected.id);
  const oldType = type.id, oldSelected = selected.id, roots = host.model.roots;
  const beforeRows = host.model.rows(), revision = host.model.revision;
  const names = new Map([...host.model.nodes.values()].filter(node => node.symbol).map(node => [node.symbol.name, node]));
  const notifications = [];
  host.model.subscribe(model => {
    for (const [id, node] of model.nodes) assert.equal(id, node.id);
    for (const [id, parent] of model.parents) {
      assert(model.nodes.has(id));
      assert(parent === null || model.nodes.has(parent));
    }
    notifications.push(model.snapshot());
  });
  const next = {...shifted(data), dirty: ['A.cs']};

  const result = host.projection.update(next);

  assert.equal(result.rebuilt, false);
  assert.equal(result.identityChanged, true);
  assert.equal(host.builds, 1);
  assert.equal(host.model.roots, roots);
  assert.notEqual(type.id, oldType);
  assert.notEqual(selected.id, oldSelected);
  assert.equal(host.model.nodes.has(oldType), false);
  assert.equal(host.model.nodes.has(oldSelected), false);
  assert.equal(host.model.nodes.get(selected.id), selected);
  assert.equal(host.model.parents.get(selected.id), type.id);
  assert(host.model.expanded.has(type.id));
  assert(host.model.selected.has(selected.id));
  assert.equal(host.model.focused, selected.id);
  assert.equal(host.model.anchor, selected.id);
  assert(host.model.seen.has(selected.id));
  assert.equal(host.model.seen.has(oldSelected), false);
  assert.equal(host.model.revision, revision + 1);
  assert.equal(notifications.length, 1);
  assert.equal(host.model.nodes.get(host.model.focused).start, next.symbols[2501].start);
  assert.notEqual(host.model.rows(), beforeRows);
  for (const node of host.model.nodes.values()) {
    if (node.symbol) assert.equal(node, names.get(node.symbol.name));
  }
  assertFresh(host.model, next);
  assert.equal(host.projection.update(next).identityChanged, false);
  assert.equal(notifications.length, 1);
});

test('ID swaps are validated as a complete map and selection follows its retained declaration', () => {
  const data = workspace(2), host = harness(data);
  const first = symbolNode(host.model, 'Method0'), second = symbolNode(host.model, 'Method1');
  const firstId = first.id, secondId = second.id;
  host.model.reveal(first.id);
  host.model.select(second.id, {toggle: true});
  const next = {...data, symbols: data.symbols.map(symbol => ({...symbol}))};
  [next.symbols[1].id, next.symbols[2].id] = [next.symbols[2].id, next.symbols[1].id];

  host.projection.update(next);

  assert.equal(first.id, secondId);
  assert.equal(second.id, firstId);
  assert.equal(host.model.nodes.get(secondId), first);
  assert.equal(host.model.nodes.get(firstId), second);
  assert.deepEqual([...host.model.selected], [secondId, firstId]);
  assert.equal(host.model.focused, firstId);
  assert.equal(host.model.anchor, firstId);
  assert.equal(host.builds, 1);
  assertFresh(host.model, next);
});

test('a scoped type follows its new compiler identity without losing the scope or child parent links', () => {
  const data = workspace(), host = harness(data);
  const scope = symbolNode(host.model, 'Example').id;
  host.projection.update(data, {scope});
  const root = host.model.roots[0], child = symbolNode(host.model, 'Method1');
  host.model.reveal(child.id);
  const next = shifted(data, 7);

  const result = host.projection.update(next, {scope});

  assert.equal(host.builds, 2, 'only entering the scope needed a hierarchy rebuild');
  assert.equal(host.model.roots[0], root);
  assert.equal(result.scope, root.id);
  assert.notEqual(result.scope, scope);
  assert.equal(host.model.parents.get(root.id), null);
  assert.equal(host.model.parents.get(child.id), root.id);
  assert.equal(host.model.focused, child.id);
  assert.equal(host.projection.update(next, {scope: result.scope}).rebuilt, false);
  assert.equal(host.builds, 2);
});

test('linked appearances receive distinct current IDs and current navigation from the same source declaration', () => {
  const data = workspace();
  data.snapshot = {solution: {path: 'Example.slnx', name: 'Example'}, projects: [
    {path: 'App/App.csproj', compile: [{path: 'A.cs', metadata: {Link: 'Shared/A.cs'}}]},
    {path: 'Other/Other.csproj', compile: [{path: 'A.cs', metadata: {Link: 'A.cs'}}]}
  ]};
  const host = harness(data);
  const appearances = [...host.model.nodes.values()].filter(node => node.symbol?.name === 'Method1');
  assert.equal(appearances.length, 2);
  host.model.reveal(appearances[0].id);
  host.model.select(appearances[1].id, {toggle: true});
  const next = {...shifted(data, -2), dirty: ['A.cs']};

  host.projection.update(next);

  assert.equal(host.builds, 1);
  assert.notEqual(appearances[0].id, appearances[1].id);
  for (const node of appearances) {
    assert.equal(host.model.nodes.get(node.id), node);
    assert(host.model.selected.has(node.id));
    assert.equal(node.start, next.symbols[2].start);
    assert.equal(node.symbol, next.symbols[2]);
  }
  assertFresh(host.model, next);
});

test('colliding or oversized identities reject before changing nodes, spans, dirty state or UI state', () => {
  const data = workspace(), host = harness(data);
  const selected = symbolNode(host.model, 'Method1');
  host.model.reveal(selected.id);
  const roots = host.model.roots, nodes = host.model.nodes, parents = host.model.parents;
  const state = host.model.snapshot(), originalId = selected.id, revision = host.model.revision;
  const invalid = [
    next => { next.symbols[2].id = next.symbols[1].id; },
    next => { next.symbols[2].id = 'x'.repeat(8192); }
  ];
  for (const damage of invalid) {
    const next = {...shifted(data), dirty: ['A.cs']};
    damage(next);
    assert.throws(() => host.projection.update(next), /Tree IDs/);
    assert.equal(host.model.roots, roots);
    assert.equal(host.model.nodes, nodes);
    assert.equal(host.model.parents, parents);
    assert.equal(selected.id, originalId);
    assert.equal(selected.symbol, data.symbols[2]);
    assert.equal(selected.start, data.symbols[2].start);
    assert.equal(host.model.revision, revision);
    assert.deepEqual(host.model.snapshot(), state);
    assertFresh(host.model, data);
  }
  assert.equal(host.builds, 1);
  assert.equal(host.projection.update(shifted(data)).identityChanged, true);
});

test('a changed display shape still uses full validation before publishing any earlier identity updates', () => {
  const data = workspace(), host = harness(data);
  const root = host.model.roots, type = symbolNode(host.model, 'Example'), id = type.id;
  const invalid = shifted(data);
  invalid.symbols.at(-1).name = 'Changed display shape';
  invalid.symbols.at(-1).id = invalid.symbols[1].id;

  assert.throws(() => host.projection.update(invalid), /Tree IDs/);

  assert.equal(host.builds, 2);
  assert.equal(host.model.roots, root);
  assert.equal(type.id, id);
  assertFresh(host.model, data);
  const next = shifted(data);
  next.symbols.at(-1).name = 'A renamed method';
  assert.equal(host.projection.update(next).rebuilt, true);
  assert.equal(host.builds, 3);
  assertFresh(host.model, next);
});

test('in-place compiler ID and location changes also rekey the retained nodes', () => {
  const data = workspace(), host = harness(data);
  const method = symbolNode(host.model, 'Method0'), old = method.id;
  data.symbols[1].id = 'A.cs:37:method';
  data.symbols[1].start = 37;
  data.symbols[1].end = 45;

  host.projection.update(data);

  assert.equal(host.builds, 1);
  assert.equal(host.model.nodes.has(old), false);
  assert.equal(host.model.nodes.get(method.id), method);
  assert.equal(method.start, 37);
  assertFresh(host.model, data);
});
