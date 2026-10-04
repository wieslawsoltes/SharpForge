import {traceRootClosure} from './root-audit.js';

export const registeredBarrierSites = Object.freeze(['field', 'element', 'static', 'root', 'bulk-copy', 'array-fill']);

/** Independent reachability oracle: compare pre-collection full-slot tracing with resulting identities. */
export function verifyTraceReachability(heap, expected) {
  const missed = [];
  for (const key of expected) {
    const [handle, generation] = key.split(':').map(Number);
    if (!heap.tryGet({h: handle, g: generation})) missed.push(key);
  }
  return {success: missed.length === 0, code: missed.length ? 'GC_BARRIER_MISS' : null, missed};
}

const stores = Object.freeze({
  field: (heap, owner, holder, child) => heap.writeField(owner, 0, child),
  element: (heap, owner, holder, child) => heap.writeElement(owner, 0, child),
  static: (heap, owner, holder, child) => heap.writeStatic(holder, 0, child),
  root: (heap, owner, holder, child) => heap.writeRoot(holder, 0, child),
  'bulk-copy': (heap, owner, holder, child) => heap.bulkCopy(owner, 0, [child], 0, 1),
  'array-fill': (heap, owner, holder, child) => heap.fillArray(owner, 0, 1, child)
});

function trial(createHeap, site, disable, noise) {
  const heap = createHeap();
  const owner = site === 'field' ? heap.object('FuzzOwner', [null]) : heap.array('object', 1);
  const holder = [null];
  heap.rootVisitor = visitor => {
    visitor(owner, 'stack', 'fuzzer-owner');
    visitor(holder[0], site === 'static' ? 'static' : 'stack', 'fuzzer-publication');
  };
  for (let index = 0; index < noise; index++) heap.object('FuzzGarbage', []);
  const child = heap.object('FuzzChild', []);
  const previousDisabled = heap.barriers.disabledSites;
  heap.barriers.disabledSites = disable ? new Set([site]) : null;
  try {
    // Publish after root termination, before the child's sweep slot. A termination
    // rescan cannot mask missing static/root insertion barriers in this fixture.
    heap.collector.startIncremental({generation: 2, reason: 'BarrierFuzz'});
    for (let count = 0; heap.collector.phase === 'mark' && count < 1024; count++) heap.collector.step(1);
    if (heap.collector.phase !== 'sweep' || !heap.tryGet(child)) throw new Error('Fuzzer could not establish an unswept child');
    stores[site](heap, owner, holder, child);
    const expected = traceRootClosure(heap);
    const verification = heap.verify({throwOnError: false});
    for (let count = 0; heap.collector.active && count < 10000; count++) heap.collector.step(1);
    if (heap.collector.active) throw new Error('Barrier fuzzer collector budget exceeded');
    return {site, omitted: disable, verifierDetected: !verification.valid,
      verificationErrors: verification.errors.map(error => error.code), ...verifyTraceReachability(heap, expected)};
  } finally {
    heap.barriers.disabledSites = previousDisabled;
    heap.dispose?.({finalize: false});
  }
}

/** Seeded scheduling fuzz; every entry point has a positive control and an omission case. */
export function fuzzBarrierOmissions(createHeap, {seed = 0x6a09e667, rounds = 2} = {}) {
  if (typeof createHeap !== 'function') throw new TypeError('A heap factory is required');
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 1000) throw new RangeError('Invalid barrier fuzz budget');
  let random = seed >>> 0;
  const results = [];
  for (let round = 0; round < rounds; round++) {
    const order = [...registeredBarrierSites];
    for (let index = order.length - 1; index > 0; index--) {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      const target = (random >>> 0) % (index + 1);
      [order[index], order[target]] = [order[target], order[index]];
    }
    for (const site of order) {
      results.push(trial(createHeap, site, false, (random >>> 0) % 7));
      results.push(trial(createHeap, site, true, (random >>> 0) % 7));
    }
  }
  return {seed, rounds, results, detected: registeredBarrierSites.filter(site =>
    results.some(result => result.site === site && result.omitted && !result.success)),
  controlsPassed: results.filter(result => !result.omitted).every(result => result.success)};
}
