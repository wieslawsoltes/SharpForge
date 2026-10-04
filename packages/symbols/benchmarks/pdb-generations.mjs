import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { PortablePdbGenerations, PortablePdbRevisionMap } from '@sharpforge/symbols';

const fixture = new URL('../../../tests/fixtures/portable-pdb-generations/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('reference.json', fixture), 'utf8'));
const baseline = readFileSync(new URL('baseline.pdb', fixture));
const deltas = reference.generations.slice(1).map((generation) => ({
  ...generation, bytes: readFileSync(new URL(`delta${generation.generation}.pdb`, fixture)),
}));
const updated = deltas[0].symbols.methods[0];
const visible = updated.points.find((point) => !point.hidden);
const samples = 100;

function history() {
  const result = new PortablePdbGenerations(baseline);
  for (const delta of deltas) result.append(delta.bytes, { baselineId: result.baselineId, previousPdbId: result.pdbId,
    generation: delta.generation, typeSystemRowCounts: delta.typeSystemRowCounts, pdbId: delta.symbols.id });
  return result;
}

function measure(action) {
  global.gc?.();
  const before = process.memoryUsage();
  const coldStart = performance.now();
  action();
  const coldMs = performance.now() - coldStart;
  for (let index = 0; index < 10; index++) action();
  const times = [];
  for (let index = 0; index < samples; index++) {
    const start = performance.now();
    action();
    times.push(performance.now() - start);
  }
  const after = process.memoryUsage();
  times.sort((left, right) => left - right);
  return { coldMs, medianMs: times[49], p95Ms: times[94], p99Ms: times[98],
    heapDeltaBytes: after.heapUsed - before.heapUsed, arrayBufferDeltaBytes: after.arrayBuffers - before.arrayBuffers };
}

const current = history();
const revisions = new PortablePdbRevisionMap(current);
const frame = { baselineId: current.baselineId, generation: 1, methodToken: updated.token, revision: 2 };
const held = revisions.capture(frame);
const results = {
  readAndAppend: measure(() => {
    const item = history();
    assert.equal(item.getMethodRevision(updated.token).revision, 2);
    item.dispose();
  }),
  firstCapture: measure(() => {
    const map = new PortablePdbRevisionMap(current);
    assert.equal(map.capture(frame).location(visible.offset).startLine, visible.startLine);
    map.dispose();
  }),
  repeatedCapture: measure(() => {
    const snapshot = revisions.capture(frame);
    assert.equal(snapshot.location(visible.offset).startLine, visible.startLine);
    snapshot.dispose();
  }),
  historyLocation: measure(() => assert.equal(current.location(updated.token, visible.offset, 1).startLine, visible.startLine)),
  snapshotLocation: measure(() => assert.equal(held.location(visible.offset).startLine, visible.startLine)),
};
revisions.dispose();
current.dispose();
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  cpu: cpus()[0]?.model, samples, generations: reference.generations.length, baselineBytes: baseline.length,
  deltaBytes: deltas.map((delta) => delta.bytes.length),
  allocationNote: 'Observed heap and ArrayBuffer deltas include GC; these are not total allocator counters.',
  qualification: 'Correctness-gated symbol parsing and snapshot lookups; no runtime ApplyUpdate or browser/native execution.',
  results }, null, 2));
