import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { symbolWorkspace, sha256, benchmarkSources, benchmarkEnvironment } from '../../../scripts/benchmarks/pdb-context.mjs';
import { measurePdbWorkloads } from '../../../scripts/benchmarks/pdb-measure.mjs';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '../../..');
const workspace = await symbolWorkspace(root);
const { PortablePdbGenerations, PortablePdbRevisionMap } = workspace.symbols;
const fixture = resolve(root, 'tests/fixtures/portable-pdb-generations');
const referenceBytes = readFileSync(resolve(fixture, 'reference.json'));
const reference = JSON.parse(referenceBytes);
assert.equal(reference.schemaVersion, 1);
assert.equal(reference.generations.length, 3);
const artifacts = Object.entries(reference.artifacts).map(([name, expected]) => {
  assert(/^[a-zA-Z0-9.]+$/.test(name), 'Fixture names must stay in the retained corpus directory');
  const bytes = readFileSync(resolve(fixture, name));
  const digest = sha256(bytes);
  assert.equal(digest, expected, 'Native artifact hash: ' + name);
  return { name, bytes: bytes.length, sha256: digest };
});
const baseline = readFileSync(resolve(fixture, 'baseline.pdb'));
const deltas = reference.generations.slice(1).map((generation) => ({
  ...generation, bytes: readFileSync(resolve(fixture, `delta${generation.generation}.pdb`)),
}));
const updated = deltas[0].symbols.methods[0];
const original = reference.generations[0].symbols.methods.find((method) => method.token === updated.token);
const visible = updated.points.find((point) => !point.hidden);
assert(original && visible, 'Native corpus must retain an updated method with a visible point');

function append(result, delta) {
  result.append(delta.bytes, { baselineId: result.baselineId, previousPdbId: result.pdbId,
    generation: delta.generation, typeSystemRowCounts: delta.typeSystemRowCounts, pdbId: delta.symbols.id });
}

function history() {
  const result = new PortablePdbGenerations(baseline);
  for (const delta of deltas) append(result, delta);
  return result;
}

// Full native symbol and historical-snapshot checks occur before any timed operation.
const checked = new PortablePdbGenerations(baseline);
const checkedRevisions = new PortablePdbRevisionMap(checked);
const old = checkedRevisions.capture({ baselineId: checked.baselineId, generation: 0, methodToken: updated.token, revision: 1 });
const nativeRevisions = new Map();
for (const generation of reference.generations) {
  if (generation.generation) append(checked, deltas[generation.generation - 1]);
  assert.equal(checked.pdbId, generation.symbols.id);
  for (const document of generation.symbols.documents) {
    const actual = checked.getDocument(document.id, generation.generation, { includeSource: false });
    assert.equal(actual.name, document.name);
  }
  for (const method of generation.symbols.methods) {
    const actual = checked.getMethod(method.token, generation.generation);
    const revision = (nativeRevisions.get(method.token) ?? 0) + 1;
    nativeRevisions.set(method.token, revision);
    assert.equal(actual.token, method.token);
    assert.equal(actual.generation, generation.generation);
    assert.equal(actual.revision, revision);
    assert.equal(actual.localSignature, method.localSignature);
    assert.deepEqual(actual.points, method.points);
    assert.deepEqual(actual.scopes.map((scope) => ({ start: scope.start, end: scope.end,
      names: scope.variables.map((local) => local.name) })), method.scopes);
  }
}
assert.deepEqual(old.points, original.points);
const checkedSnapshot = checkedRevisions.capture({ baselineId: checked.baselineId, generation: 2,
  methodToken: updated.token, revision: 2 });
assert.deepEqual(checkedSnapshot.points, updated.points);
assert.equal(checkedSnapshot.reference.symbolGeneration, 1);
const document = deltas[0].symbols.documents.find((item) => item.id === visible.document);
assert(document);
const expectedLocation = { ...visible, source: document.name, generation: 1, revision: 2 };
assert.deepEqual(checked.location(updated.token, visible.offset, 1), expectedLocation);
checked.dispose();
assert.deepEqual(old.points, original.points);
assert.deepEqual(checkedSnapshot.location(visible.offset), expectedLocation);
checkedRevisions.dispose();
assert(old.disposed && checkedSnapshot.disposed);

const current = history();
const revisions = new PortablePdbRevisionMap(current);
const frame = { baselineId: current.baselineId, generation: 1, methodToken: updated.token, revision: 2 };
const held = revisions.capture(frame);
const expectedReference = { ...frame, symbolGeneration: 1 };
const consumeLocation = (location) => {
  assert.deepEqual(location, expectedLocation);
  return location.startLine + location.endLine + location.document + location.offset;
};
const consumeSnapshot = (snapshot) => {
  assert.deepEqual(snapshot.reference, expectedReference);
  return consumeLocation(snapshot.location(visible.offset));
};
const workloads = [
  { name: 'readAndAppend', operation: history,
    consume: (item) => {
      assert.equal(item.generation, 2);
      assert.equal(item.pdbId, reference.generations[2].symbols.id);
      assert.deepEqual(item.getMethodRevision(updated.token), { methodToken: updated.token,
        generation: 1, revision: 2, pointCount: updated.points.length });
      return item.generation + updated.points.length + item.getMethodRevision(updated.token).revision;
    }, cleanup: (item) => item.dispose() },
  { name: 'firstCapture', operation: () => {
    const map = new PortablePdbRevisionMap(current);
    return { map, snapshot: map.capture(frame) };
  }, consume: ({ snapshot }) => consumeSnapshot(snapshot), cleanup: ({ map }) => map.dispose() },
  { name: 'repeatedCapture', operation: () => revisions.capture(frame),
    consume: consumeSnapshot, cleanup: (snapshot) => snapshot.dispose() },
  { name: 'historyLocation', operation: () => current.location(updated.token, visible.offset, 1), consume: consumeLocation },
  { name: 'snapshotLocation', operation: () => held.location(visible.offset), consume: consumeLocation },
].map((workload) => ({ library: 'current', ...workload }));
const environment = benchmarkEnvironment();
const measured = measurePdbWorkloads(workloads);
revisions.dispose();
current.dispose();
console.log(JSON.stringify({ schemaVersion: 2,
  scope: 'New generation and snapshot API costs; no baseline speedup comparison', environment,
  benchmarkSources: benchmarkSources([script, resolve(root, 'scripts/benchmarks/pdb-context.mjs'),
    resolve(root, 'scripts/benchmarks/pdb-measure.mjs')]),
  libraries: [{ name: 'current', ...workspace.provenance }],
  fixture: { referenceSha256: sha256(referenceBytes), sdk: reference.sdk, runtime: reference.runtime,
    compiler: reference.compiler, compilerSha256: reference.compilerSha256, artifacts,
    generations: reference.generations.length, methodToken: updated.token, ilOffset: visible.offset },
  correctness: { nativeSymbolFacts: true, oldSnapshotSurvivesUpdatesAndProviderDisposal: true,
    methodRevisionAndLocation: true, hashesVerifiedBeforeTiming: true },
  workloadNotes: { readAndAppend: 'Construct baseline and append both deltas; disposal outside timing',
    firstCapture: 'Construct a new revision map and capture with an empty cache; not process-cold',
    repeatedCapture: 'Capture with the same map already held by another snapshot; disposal outside timing',
    historyLocation: 'Query generation 1 in the retained three-generation history',
    snapshotLocation: 'Query the retained generation-1 snapshot' },
  qualification: 'Retained Roslyn/SRM corpus comparison; no live native, browser or runtime ApplyUpdate execution',
  ...measured }, null, 2));
