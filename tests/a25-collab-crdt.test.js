import test from 'node:test';
import assert from 'node:assert/strict';
import { SequenceCrdt } from '../packages/git/src/collab/crdt.js';
import {
  encodeCollaborationUpdate, decodeCollaborationUpdate,
  encodeCollaborationSnapshot, decodeCollaborationSnapshot
} from '../packages/git/src/collab/encoding.js';

function document(actorId, options = {}) {
  return new SequenceCrdt({ actorId, workspaceId: 'workspace', documentId: 'Program.cs', ...options });
}

function randomGenerator(seed) {
  let value = seed >>> 0;
  return maximum => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value % maximum;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = random(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

test('three disconnected replicas converge after 10000 deterministic edits, duplicates and reverse causal delivery', () => {
  const replicas = ['alpha', 'beta', 'gamma'].map(actor => document(actor));
  const updates = [];
  const random = randomGenerator(0x5f25c0de);
  for (let step = 0; step < 10000; step++) {
    const replica = replicas[random(3)];
    const shouldDelete = replica.length > 100 || replica.length && random(3) === 0;
    if (shouldDelete) {
      const offset = random(replica.length);
      updates.push(replica.delete(offset, Math.min(1 + random(4), replica.length - offset)));
    } else {
      const text = String.fromCharCode(65 + random(26)).repeat(1 + random(3));
      updates.push(replica.insert(random(replica.length + 1), text));
    }
    if (step % 31 === 0) replicas[random(3)].apply(updates[random(updates.length)]);
  }
  for (const replica of replicas) {
    for (const update of shuffled(updates, random)) {
      replica.apply(update);
      assert.equal(replica.apply(update), false);
    }
  }
  assert.equal(replicas[0].text, replicas[1].text);
  assert.equal(replicas[1].text, replicas[2].text);
  assert.equal(replicas[0].text, referenceText(updates));
  for (const replica of replicas) {
    assert.equal(replica.stats.pendingNodes, 0);
    assert.equal(replica.stats.operations, 10000);
    assert.equal(replica.length, replica.text.length);
    assert(replica.stats.indexHeight < 2 * Math.log2(replica.stats.nodes * 2 + 2));
  }
  assert.deepEqual(encodeCollaborationSnapshot(replicas[0].snapshot()), encodeCollaborationSnapshot(replicas[2].snapshot()));
});

test('deletes arriving before inserts and children arriving before parents remain durable tombstones', () => {
  const first = document('first');
  const second = document('second');
  const parent = first.insert(0, 'A');
  const child = first.insert(1, 'BC');
  const deletion = first.delete(0, 2);
  second.apply(deletion);
  second.apply(child);
  assert.equal(second.text, '');
  assert.equal(second.stats.pendingNodes, 2);
  const restored = SequenceCrdt.fromSnapshot(second.snapshot(), { actorId: 'restored' });
  restored.apply(parent);
  assert.equal(restored.text, 'C');
  assert.equal(restored.stats.pendingNodes, 0);
});

test('concurrent insertion runs retain each run and preserve ordinary local insertion intent', () => {
  const first = document('alpha');
  const second = document('beta');
  const seed = first.insert(0, '[]');
  second.apply(seed);
  const left = first.insert(1, 'ABC');
  const right = second.insert(1, 'xyz');
  first.apply(right);
  second.apply(left);
  assert.equal(first.text, '[xyzABC]');
  assert.equal(second.text, first.text);
  first.insert(2, '!');
  assert.equal(first.text, '[x!yzABC]');
});

test('UTF-16 source offsets, CRLF locations and stable cursor association agree with SourceText', () => {
  const first = document('first');
  const update = first.insert(0, 'a😀\r\nb');
  assert.equal(first.length, 6);
  const source = first.toSourceText('test.cs');
  assert.deepEqual(source.positionAt(6), { line: 1, character: 1 });
  assert.equal(source.offsetAt({ line: 1, character: 0 }), 5);
  const before = first.anchorAt(1, 'left');
  const after = first.anchorAt(1, 'right');
  first.insert(1, 'XX');
  assert.equal(first.resolveAnchor(before), 1);
  assert.equal(first.resolveAnchor(after), 3);
  const second = document('second');
  second.apply(decodeCollaborationUpdate(encodeCollaborationUpdate(update)));
  assert.equal(second.text, 'a😀\r\nb');
});

test('transaction change ranges reconstruct text after random local and remote integration', () => {
  const first = document('first');
  const second = document('second');
  let rendered = '';
  second.subscribe(event => {
    for (const change of event.changes) {
      rendered = rendered.slice(0, change.start) + change.insertText + rendered.slice(change.start + change.deleteCount);
    }
  });
  const one = first.insert(0, 'abcdef');
  const two = first.replace(2, 2, 'XYZ');
  const three = first.delete(1, 3);
  second.apply(three);
  second.apply(two);
  second.apply(one);
  assert.equal(rendered, second.text);
  assert.equal(rendered, first.text);
});

test('malformed, foreign, identity-conflicting and over-limit updates leave document state unchanged', () => {
  const first = document('first');
  const original = first.insert(0, 'ab');
  const before = first.snapshot();
  assert.throws(() => first.apply({ ...original, inserts: [{ ...original.inserts[0], value: 'x' }, original.inserts[1]] }),
    error => error.code === 'Conflict');
  assert.throws(() => first.apply({ ...original, workspaceId: 'another' }), error => error.code === 'Auth');
  assert.throws(() => first.apply({ ...original, version: 2 }), error => error.code === 'Corrupt');
  assert.throws(() => first.apply({ ...original, id: 'first:2', inserts: [], deletes: ['first:1'] }), error => error.code === 'Conflict');
  assert.throws(() => first.apply({ ...original, id: 'first:3', inserts: [{ id: 'first:3', parent: 'first:4', value: 'x' }] }),
    error => error.code === 'Corrupt');
  assert.deepEqual(first.snapshot(), before);
  const bounded = document('bounded', { limits: { maxNodes: 2 } });
  assert.throws(() => bounded.insert(0, 'abc'), error => error.code === 'Limit');
  assert.equal(bounded.text, '');
  assert.throws(() => first.replace(-1, 0, 'x'), error => error.code === 'Limit');
  assert.throws(() => decodeCollaborationUpdate(Uint8Array.of(0xff)), error => error.code === 'Corrupt');
});

test('snapshot union is atomic, cancellable and retains edits entered while a sync is staged', async () => {
  const first = document('first');
  const second = document('second');
  first.insert(0, 'one');
  second.insert(0, 'two');
  const snapshot = decodeCollaborationSnapshot(encodeCollaborationSnapshot(first.snapshot()));
  await second.mergeSnapshot(snapshot);
  assert.equal(second.text, 'twoone');
  const stable = second.text;
  const abort = new AbortController();
  await assert.rejects(second.mergeSnapshot(snapshot, {
    signal: abort.signal, yieldEvery: 1, yieldTask: async () => abort.abort()
  }), error => error.code === 'Cancelled');
  assert.equal(second.text, stable);
  let once = false;
  await second.mergeSnapshot(snapshot, {
    yieldEvery: 1, yieldTask: async () => { if (!once) { once = true; second.insert(0, '!'); } }
  });
  assert.equal(second.text, '!' + stable);
});

test('disposal releases observers and refuses subsequent operations', () => {
  const value = document('disposable');
  let calls = 0;
  value.subscribe(() => calls++);
  value.insert(0, 'x');
  value.dispose();
  value.dispose();
  assert.equal(calls, 1);
  assert.throws(() => value.insert(0, 'x'), error => error.code === 'Disposed');
  assert.throws(() => value.anchorAt(0), error => error.code === 'Disposed');
});

// A deliberately unindexed specification model checks visible RGA order independently of AVL mutation.
function referenceText(updates) {
  const children = new Map();
  const deleted = new Set();
  for (const update of updates) {
    for (const entry of update.inserts) {
      const list = children.get(entry.parent) ?? [];
      list.push(entry);
      children.set(entry.parent, list);
    }
    for (const id of update.deletes) deleted.add(id);
  }
  for (const list of children.values()) list.sort((left, right) => {
    const [leftActor, leftClock] = left.id.split(':');
    const [rightActor, rightClock] = right.id.split(':');
    return Number(rightClock) - Number(leftClock) || (leftActor < rightActor ? 1 : leftActor > rightActor ? -1 : 0);
  });
  const stack = [...(children.get(null) ?? [])].reverse();
  const output = [];
  while (stack.length) {
    const entry = stack.pop();
    if (!deleted.has(entry.id)) output.push(entry.value);
    const nested = children.get(entry.id) ?? [];
    for (let index = nested.length - 1; index >= 0; index--) stack.push(nested[index]);
  }
  return output.join('');
}
