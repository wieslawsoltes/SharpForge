import test from 'node:test';
import assert from 'node:assert/strict';
import {isReference} from '@sharpforge/runtime';
import {ownsHeapReference} from '../packages/runtime/src/execution/heap-reference.js';
import {booleanFieldHost, booleanFieldEngines, assertStringInitializationReleased, observeAllocation} from './fixtures/a07/boolean-string-fields.js';

for (const engine of booleanFieldEngines) {
  for (const weakStringInterning of [false, true]) {
    test(`Boolean field lifetime ${engine}, weak ${weakStringInterning}: canonical values are retained by field storage`, () => {
      const host = booleanFieldHost(engine, {weakStringInterning});
      const {vm} = host;
      try {
        assert.equal(host.has('TrueString'), false);
        const value = host.read();
        assert.equal(isReference(value), true);
        assert.equal(vm.heap.get(value).data, 'True');
        const allocations = vm.heap.stats.allocations;
        assert.equal(host.read(), value);
        assert.equal(host.literal(), value);
        assert.equal(vm.heap.stats.allocations, allocations);
        const unrelated = host.literal('ordinary unrooted literal');
        vm.heap.collect();
        assert.equal(vm.heap.get(value).data, 'True');
        assert.equal(host.read(), value);
        assert.equal(host.literal(), value);
        if (weakStringInterning) assert.throws(() => vm.heap.get(unrelated), {name: 'InvalidReferenceException'});
        else assert.equal(vm.heap.get(unrelated).data, 'ordinary unrooted literal');
        assertStringInitializationReleased(host);
      } finally { host.stop(); }
    });
  }

  test(`Boolean field lifetime ${engine}: snapshots before and after initialization restore the exact retained references`, () => {
    const host = booleanFieldHost(engine, {weakStringInterning: true});
    const {vm} = host;
    try {
      const empty = vm.snapshot();
      const first = host.read();
      const saved = vm.snapshot();
      const later = host.read('FalseString');
      assert.equal(vm.heap.get(later).data, 'False');
      vm.restore(saved);
      assert.equal(host.read(), first);
      assert.equal(host.literal(), first);
      assert.equal(host.has('FalseString'), false);
      assert.equal(vm.strings.has('False'), false);
      assert.throws(() => vm.heap.get(later), {name: 'InvalidReferenceException'});
      vm.heap.collect();
      assert.equal(vm.heap.get(first).data, 'True');
      vm.restore(empty);
      assert.equal(host.has('TrueString'), false);
      assert.equal(vm.strings.has('True'), false);
      assert.throws(() => vm.heap.get(first), {name: 'InvalidReferenceException'});
      const replayed = host.read();
      assert.equal(vm.heap.get(replayed).data, 'True');
      assert.notEqual(replayed.g, first.g);
      assertStringInitializationReleased(host);
    } finally { host.stop(); }
  });

  test(`Boolean field lifetime ${engine}: two VMs own independent references and snapshots`, () => {
    const left = booleanFieldHost(engine, {weakStringInterning: true});
    const right = booleanFieldHost(engine, {weakStringInterning: true});
    try {
      const first = left.read(), second = right.read();
      assert.notEqual(first, second);
      assert.equal(ownsHeapReference(left.vm.heap, first), true);
      assert.equal(ownsHeapReference(left.vm.heap, second), false);
      assert.equal(ownsHeapReference(right.vm.heap, first), false);
      const saved = right.vm.snapshot();
      left.stop();
      left.vm.heap.collect();
      assert.equal(right.vm.heap.get(second).data, 'True');
      right.vm.restore(saved);
      assert.equal(right.read(), second);
      assertStringInitializationReleased(right);
    } finally { left.stop(); right.stop(); }
  });

  for (const direction of ['field-first', 'literal-first']) {
    test(`Boolean field lifetime ${engine}: ${direction} nested allocation preserves the published canonical string`, () => {
      const host = booleanFieldHost(engine, {weakStringInterning: true});
      let calls = 0, nested;
      const undo = observeAllocation(host, () => {
        if (++calls === 1) nested = direction === 'field-first' ? host.literal() : host.read();
        host.vm.heap.collect(nested ? [nested] : []);
      });
      try {
        const outer = direction === 'field-first' ? host.read() : host.literal();
        assert.equal(calls, 2, 'One nested canonical initialization completes without recursive allocation');
        assert.equal(outer, nested, 'The outer allocation must reuse the value published by the observer');
        assert.equal(host.read(), nested);
        assert.equal(host.literal(), nested);
        assert.equal(host.vm.strings.get('True'), nested);
        host.vm.heap.collect();
        assert.equal(host.vm.heap.get(nested).data, 'True');
        assertStringInitializationReleased(host);
      } finally { undo(); host.stop(); }
    });
  }

  test(`Boolean field lifetime ${engine}: a collector in the allocation observer cannot reclaim the unfinished field value`, () => {
    const host = booleanFieldHost(engine, {weakStringInterning: true});
    let calls = 0;
    const undo = observeAllocation(host, () => {
      calls++;
      const rooted = host.vm.heap.pins.find(reference => host.vm.heap.get(reference).data === 'True');
      assert(rooted, 'The allocator roots its newly issued string before invoking observers');
      host.vm.heap.collect();
      assert.equal(host.vm.heap.get(rooted).data, 'True');
      assert.equal(host.has('TrueString'), false, 'Only a complete initialization enters field storage');
    });
    try {
      const value = host.read();
      assert.equal(calls, 1);
      assert.equal(host.vm.heap.get(value).data, 'True');
      assertStringInitializationReleased(host);
    } finally { undo(); host.stop(); }
  });
}
