import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ManagedHeap} from '@sharpforge/runtime';
import {cases, runStressProgram, withAllocationStress, unsupported} from '../../../../scripts/conformance/gc/stress.js';
for (const fixture of cases) for (const engine of ['source', 'cil']) test(`GC every-allocation ${engine}: ${fixture.id}`, async () => {
  const source = await readFile(new URL(`./programs/${fixture.id}.cs`, import.meta.url), 'utf8');
  const result = runStressProgram(source, {engine});
  assert.equal(result.status, fixture.fault ? 'faulted' : 'terminated', JSON.stringify(result));
  if (fixture.fault) assert.equal(result.fault, fixture.fault); else assert.equal(result.output, fixture.output);
  assert(result.stressCollections > 0); assert(result.stressCollections >= result.allocations);
});
test('GC stress host weak handles clear and stale generations cannot alias reused slots', () => {
  withAllocationStress(() => { const heap = new ManagedHeap(); const old = heap.string('old'), weak = heap.createHandle(old, {weak: true});
    const fresh = heap.string('fresh'); assert.equal(heap.getHandle(weak), null); assert.throws(() => heap.get(old), /Stale/); assert.equal(heap.get(fresh).data, 'fresh'); });
});
test('GC stress restores instrumentation on failure and rejects nested/asynchronous runs', () => {
  const reserve = ManagedHeap.prototype.reserve;
  assert.throws(() => withAllocationStress(() => { throw new Error('fixture'); }), /fixture/); assert.equal(ManagedHeap.prototype.reserve, reserve);
  assert.throws(() => withAllocationStress(() => withAllocationStress(() => {})), /overlap/);
  assert.throws(() => withAllocationStress(() => Promise.resolve()), /synchronous/); assert.equal(ManagedHeap.prototype.reserve, reserve);
  assert(unsupported.some(row => row.feature === 'resurrection')); assert(unsupported.some(row => row.feature === 'rust-collector'));
});
