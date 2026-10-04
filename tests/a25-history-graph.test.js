import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutCommitGraph } from '../packages/git/src/index.js';

const names = ['root', 'a', 'b', 'c', 'x', 'y', 'merge', 'isolated'];
const ids = Object.fromEntries(names.map((name, index) => [name, (index + 1).toString(16).padStart(40, '0')]));
const labels = new Map(Object.entries(ids).map(([name, oid]) => [oid, name]));
const commit = (name, ...parents) => ({ oid: ids[name], parents: parents.map(parent => ids[parent]) });
const summary = result => result.rows.map(row => ({
  name: labels.get(row.oid), lane: row.lane, through: row.through,
  edges: row.edges.map(edge => [edge.from, edge.to, labels.get(edge.parent), edge.parentIndex])
}));

test('graph snapshots preserve linear ancestry and reuse a finished disconnected lane', () => {
  const result = layoutCommitGraph([commit('c', 'b'), commit('b', 'a'), commit('a'), commit('isolated')]);
  assert.deepEqual(summary(result), [
    { name: 'c', lane: 0, through: [], edges: [[0, 0, 'b', 0]] },
    { name: 'b', lane: 0, through: [], edges: [[0, 0, 'a', 0]] },
    { name: 'a', lane: 0, through: [], edges: [] },
    { name: 'isolated', lane: 0, through: [], edges: [] }
  ]);
  assert.equal(result.width, 1);
  assert.deepEqual(result.state, { lanes: [], width: 1 });
  assert.deepEqual(layoutCommitGraph([]), { rows: [], width: 1, state: { lanes: [], width: 1 } });
});

test('octopus graph snapshot keeps all parent edges and joins the common ancestor', () => {
  const result = layoutCommitGraph([
    commit('merge', 'a', 'b', 'c'), commit('a', 'root'), commit('b', 'root'), commit('c', 'root'), commit('root')
  ]);
  assert.deepEqual(summary(result), [
    { name: 'merge', lane: 0, through: [], edges: [[0, 0, 'a', 0], [0, 1, 'b', 1], [0, 2, 'c', 2]] },
    { name: 'a', lane: 0, through: [1, 2], edges: [[0, 0, 'root', 0]] },
    { name: 'b', lane: 1, through: [0, 2], edges: [[1, 0, 'root', 0]] },
    { name: 'c', lane: 2, through: [0], edges: [[2, 0, 'root', 0]] },
    { name: 'root', lane: 0, through: [], edges: [] }
  ]);
  assert.equal(result.width, 3);
  assert.deepEqual(result.state, { lanes: [], width: 3 });
});

test('criss-cross graph snapshot preserves both shared merge bases across page boundaries', () => {
  const commits = [commit('merge', 'x', 'y'), commit('x', 'a', 'b'), commit('y', 'b', 'a'),
    commit('a', 'root'), commit('b', 'root'), commit('root')];
  const complete = layoutCommitGraph(commits);
  assert.deepEqual(summary(complete), [
    { name: 'merge', lane: 0, through: [], edges: [[0, 0, 'x', 0], [0, 1, 'y', 1]] },
    { name: 'x', lane: 0, through: [1], edges: [[0, 0, 'a', 0], [0, 2, 'b', 1]] },
    { name: 'y', lane: 1, through: [0, 2], edges: [[1, 2, 'b', 0], [1, 0, 'a', 1]] },
    { name: 'a', lane: 0, through: [2], edges: [[0, 0, 'root', 0]] },
    { name: 'b', lane: 2, through: [0], edges: [[2, 0, 'root', 0]] },
    { name: 'root', lane: 0, through: [], edges: [] }
  ]);
  for (let boundary = 1; boundary < commits.length; boundary++) {
    const first = layoutCommitGraph(commits.slice(0, boundary));
    const snapshot = structuredClone(first.state);
    const second = layoutCommitGraph(commits.slice(boundary), { state: first.state });
    assert.deepEqual([...first.rows, ...second.rows], complete.rows);
    assert.deepEqual(second.state, complete.state);
    assert.deepEqual(first.state, snapshot, 'continuation does not mutate the prior page');
  }
});

test('graph output and its nested records are immutable', () => {
  const result = layoutCommitGraph([commit('merge', 'a', 'b')]);
  for (const value of [result, result.rows, result.rows[0], result.rows[0].edges, result.rows[0].edges[0],
    result.rows[0].through, result.state, result.state.lanes]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => result.state.lanes.push(ids.c), TypeError);
  assert.throws(() => { result.rows[0].edges[0].to = 99; }, TypeError);
});

test('graph rejects malformed commit identities, parents and duplicate records with typed diagnostics', () => {
  for (const commits of [null, {}, 'not commits', [null], [{}], [{ oid: '' }], [{ oid: 42 }],
    [{ oid: 'a'.repeat(129) }], [{ oid: ids.a, parents: 'not parents' }], [{ oid: ids.a, parents: [null] }],
    [{ oid: ids.a, parents: [''] }], [{ oid: ids.a, parents: [ids.a] }],
    [{ oid: ids.a, parents: [ids.b, ids.b] }], [commit('a'), commit('a')]]) {
    assert.throws(() => layoutCommitGraph(commits), { code: 'Corrupt' });
  }
});

test('graph enforces row, lane and resumed frontier bounds', () => {
  for (const maxLanes of [0, -1, 0.5, 1025, Infinity]) {
    assert.throws(() => layoutCommitGraph([], { maxLanes }), { code: 'Limit' });
  }
  assert.throws(() => layoutCommitGraph(Array(1000001)), { code: 'Limit' });
  assert.throws(() => layoutCommitGraph([commit('merge', 'a', 'b')], { maxLanes: 1 }), { code: 'Limit' });
  for (const lanes of [[ids.a, ids.a], [''], [42], ['a'.repeat(129)]]) {
    assert.throws(() => layoutCommitGraph([], { state: { lanes } }), { code: 'Corrupt' });
  }
  assert.throws(() => layoutCommitGraph([], { maxLanes: 1, state: { lanes: [ids.a, ids.b] } }), { code: 'Limit' });
  assert.throws(() => layoutCommitGraph([], { maxLanes: 2, state: { lanes: [], width: 3 } }), { code: 'Limit' });
  const frontier = { lanes: [null, ids.a], width: 2 };
  assert.equal(layoutCommitGraph([commit('a')], { state: frontier }).rows[0].lane, 1);
  assert.deepEqual(frontier, { lanes: [null, ids.a], width: 2 });
});

test('graph cancellation cannot expose or mutate a partial resumed frontier', () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => layoutCommitGraph([commit('a')], { signal: controller.signal }), { code: 'Cancelled' });
  const state = { lanes: [ids.c], width: 1 };
  let checks = 0;
  const signal = { get aborted() { return ++checks >= 2; } };
  assert.throws(() => layoutCommitGraph([commit('c', 'b'), commit('b', 'a'), commit('a')], { state, signal }), { code: 'Cancelled' });
  assert.deepEqual(state, { lanes: [ids.c], width: 1 });
});
