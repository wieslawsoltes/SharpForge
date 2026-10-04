import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '@sharpforge/runtime';

test('A06 verifier: omitted old-to-young barriers produce a concrete invariant report', () => {
  const heap = new ManagedHeap({generational: true, gcStress: false});
  const owner = heap.object('Node', [null]);
  heap.rootProvider = () => [owner];
  heap.collect();
  heap.collect();
  const child = heap.object('Child', []);
  heap.barriers.disabledSites = new Set(['field']);
  heap.writeField(owner, 0, child);
  heap.barriers.disabledSites = null;
  const report = heap.verify({throwOnError: false});
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(error => error.code === 'GC_VERIFY_MISSING_CARD'));
  heap.writeField(owner, 0, child);
  assert.equal(heap.verify().valid, true);
});

test('A06 verifier: invalid free slots, duplicate entries and dangling references are diagnosed', () => {
  const heap = new ManagedHeap({gcStress: false});
  const reference = heap.object('Node', [null]);
  heap.free.push(reference.h, reference.h);
  const report = heap.verify({throwOnError: false});
  assert.ok(report.errors.some(error => error.code === 'GC_VERIFY_DUPLICATE_FREE'));
  assert.ok(report.errors.some(error => error.code === 'GC_VERIFY_FREE_SLOT'));
});

test('A06 roots: throwing root enumerators always unwind partially installed temporary roots', () => {
  const heap = new ManagedHeap({gcStress: false});
  const root = heap.object('Node', []);
  function* broken() { yield root; throw new Error('root iterator failed'); }
  assert.throws(() => heap.withRoots(broken(), () => undefined), /root iterator failed/);
  assert.equal(heap.pins.length, 0);
  assert.throws(() => heap.allocate('object', 'Node', [], broken()), /root iterator failed/);
  assert.equal(heap.pins.length, 0);
});
