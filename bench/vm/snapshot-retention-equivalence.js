import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRetentionFixture} from './snapshot-retention-fixtures.js';

function equalHeaps(actual, expected, hash) {
  assert.deepEqual(actual.generations, expected.generations);
  assert.deepEqual(actual.free, expected.free);
  assert.deepEqual(actual.stats, expected.stats);
  assert.equal(actual.generationCounter, expected.generationCounter);
  assert.equal(actual.nextHandleId, expected.nextHandleId);
  assert.equal(actual.threshold, expected.threshold);
  assert.deepEqual([...actual.handles], [...expected.handles]);
  assert.equal(actual.records.length, expected.records.length);
  for (let index = 0; index < actual.records.length; index++) {
    const left = actual.records[index], right = expected.records[index];
    assert.equal(left.kind, right.kind);
    assert.equal(left.type, right.type);
    assert.equal(left.size, right.size);
    assert.equal(left.methodTable.name, right.methodTable.name);
    hash.update(left.kind + ':' + left.type + ':' + left.size + '\n');
    if (ArrayBuffer.isView(left.data)) {
      assert.equal(left.data.constructor, right.data.constructor);
      const first = Buffer.from(left.data.buffer, left.data.byteOffset, left.data.byteLength);
      const second = Buffer.from(right.data.buffer, right.data.byteOffset, right.data.byteLength);
      assert(first.equals(second), 'Restored payload differs at record ' + index);
      assert.notEqual(left.data.buffer, right.data.buffer, 'Each restore must own independent mutable bytes');
      hash.update(first);
    } else {
      assert.deepEqual(left.data, right.data);
      if (Array.isArray(left.data)) assert.notEqual(left.data, right.data);
      hash.update(JSON.stringify(left.data));
    }
  }
}

/** Compare every retained version against independently replayed mutations and a full-copy capture. */
export async function verifyRetentionRestores(scenario, snapshots, sharedRestore, collect) {
  const reference = createRetentionFixture(scenario);
  const fullRestore = reference.heap;
  const hash = createHash('sha256');
  for (let revision = 0; revision < snapshots.length; revision++) {
    reference.mutate(revision);
    const full = reference.heap.snapshot({shared: false});
    sharedRestore.restore(snapshots[revision]);
    fullRestore.restore(full);
    equalHeaps(sharedRestore, fullRestore, hash);
    if ((revision & 7) === 7) await collect();
  }
  return {equal: true, revisions: snapshots.length, comparedRestoredStateSHA256: hash.digest('hex'),
    policy: 'Every shared snapshot restored into detached mutable storage and compared byte-for-byte/field-for-field ' +
      'against a separately replayed full-copy snapshot. Full-copy reference versions are released each iteration.'};
}
