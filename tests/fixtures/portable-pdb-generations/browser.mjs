import { readMetadata, decodeCoded } from '@sharpforge/cil';
import {
  readPortablePdb, readPortablePdbDelta, emitPortablePdbDelta,
  PortablePdbGenerations, PortablePdbRevisionMap, SymbolError, hex,
} from '@sharpforge/symbols';

const corpus = new URL('./', import.meta.url);
const writtenCorpus = new URL('../portable-pdb-delta-writer/', import.meta.url);
const canonical = (value) => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
function assert(value, label) { if (!value) throw Error(label); }
function equal(actual, expected, label) {
  assert(JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)), label);
}
function rejects(action, expected) {
  try { action(); } catch (error) {
    assert(error instanceof SymbolError, `Expected SymbolError; received ${error.name}: ${error.message}`);
    assert(expected instanceof RegExp ? expected.test(error.message) : error.code === expected,
      `Expected ${expected}; received ${error.code}: ${error.message}`);
    return;
  }
  throw Error('Expected rejection: ' + expected);
}
async function request(base, name) {
  const response = await fetch(new URL(name, base));
  assert(response.ok, 'Native corpus unavailable: ' + name);
  return response;
}
async function artifact(base, name, expected) {
  const bytes = new Uint8Array(await (await request(base, name)).arrayBuffer());
  assert(hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))) === expected, 'Native corpus hash: ' + name);
  return bytes;
}
function methodFacts(pdb) {
  return pdb.methods.map(({ token, localSignature, points }) => ({ token, localSignature, points,
    scopes: pdb.scopes.filter((scope) => scope.methodToken === token).map((scope) => ({
      start: scope.start, end: scope.end, names: scope.variables.map((variable) => variable.name),
    })) }));
}
function nativeFacts(reference) {
  return reference.methods.map(({ token, localSignature, points, scopes }) => ({ token, localSignature, points, scopes }));
}
function compareNative(pdb, reference) {
  equal(pdb.documents.map(({ id, name }) => ({ id, name })), reference.documents, 'Native document identities');
  equal(methodFacts(pdb), nativeFacts(reference), 'Native method points, signatures and scopes');
  equal((pdb.metadata.rows[31] ?? []).map(([value]) => value), reference.mapping, 'Native EnC map');
  assert(pdb.idHex === reference.id, 'Native PDB identity');
}
function writerInput(generation) {
  const method = generation.symbols.methods[0];
  return {
    sources: generation.symbols.documents.map(({ name }) => ({ uri: name, text: 'Native delta writer fixture' })),
    methods: [{ token: method.token, codeSize: Math.max(...method.scopes.map((scope) => scope.end)),
      localSignature: method.localSignature, points: method.points, scopes: method.scopes.map((scope, index) => ({
        start: scope.start, end: scope.end, locals: scope.names.map((name, slot) => ({ name, slot })),
        constants: index === 0 ? [{ name: 'Answer', type: 'int', value: 42 }] : [],
      })) }],
    custom: [{ parent: method.token, kind: '00112233-4455-6677-8899-aabbccddeeff', bytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) }],
  };
}

/** Browser source-module qualification against hashed Roslyn/SRM reference artifacts; no managed runtime invocation. */
export async function run() {
  const checks = [];
  const reference = await (await request(corpus, 'reference.json')).json();
  const baseline = await artifact(corpus, 'baseline.pdb', reference.artifacts['baseline.pdb']);
  const deltas = [];
  for (const generation of reference.generations.slice(1)) {
    const name = `delta${generation.generation}.pdb`;
    deltas.push({ ...generation, bytes: await artifact(corpus, name, reference.artifacts[name]) });
  }
  compareNative(readPortablePdb(baseline), reference.generations[0].symbols);
  const history = new PortablePdbGenerations(baseline);
  const revisions = new PortablePdbRevisionMap(history);
  const updated = deltas[0].symbols.methods[0];
  const before = reference.generations[0].symbols.methods.find((method) => method.token === updated.token);
  const frame = { baselineId: history.baselineId, generation: 0, methodToken: updated.token, revision: 1 };
  const old = revisions.capture(frame);
  const envelope = (delta) => ({ baselineId: history.baselineId, previousPdbId: history.pdbId,
    generation: delta.generation, typeSystemRowCounts: delta.typeSystemRowCounts, pdbId: delta.symbols.id });
  rejects(() => history.append(deltas[0].bytes, { ...envelope(deltas[0]), baselineId: '0'.repeat(40) }), 'PDB_BASELINE_MISMATCH');
  rejects(() => history.append(deltas[0].bytes, { ...envelope(deltas[0]), previousPdbId: '0'.repeat(40) }), 'PDB_PREVIOUS_GENERATION_MISMATCH');
  rejects(() => history.append(deltas[0].bytes, { ...envelope(deltas[0]), generation: 2 }), 'PDB_GENERATION_MISMATCH');
  assert(history.generation === 0, 'Rejected identity changed history');
  for (const delta of deltas) {
    const parsed = readPortablePdbDelta(delta.bytes, { typeSystemRowCounts: delta.typeSystemRowCounts });
    compareNative(parsed, delta.symbols);
    rejects(() => readPortablePdb(delta.bytes), /non-debug tables/);
    history.append(delta.bytes, envelope(delta));
  }
  equal(history.getMethodByVersion(updated.token, 1).points, before.points, 'Version one baseline');
  equal(history.getMethodByVersion(updated.token, 2).points, updated.points, 'Version two update');
  checks.push('SHA-256 pinned baseline/two real Roslyn deltas; native documents, points, local signatures and scopes',
    'Strict baseline entry point and baseline/previous-generation/ordinal mismatch diagnostics');

  const current = revisions.capture({ ...frame, generation: 2, revision: 2 });
  assert(current.reference.generation === 2 && current.reference.symbolGeneration === 1, 'Unchanged method generation identity');
  assert(Object.isFrozen(current.reference), 'Mutable snapshot reference');
  equal(old.points, before.points, 'Old snapshot after two updates');
  equal(current.points, updated.points, 'Updated snapshot map');
  const first = updated.points.find((point) => !point.hidden);
  assert(old.location(before.points[0].offset).startLine === before.points[0].startLine, 'Old snapshot line');
  assert(current.location(first.offset).startLine === first.startLine, 'Current snapshot line');
  const originalHash = [...current.getDocument(first.document).hash];
  current.getDocument(first.document).hash.fill(0);
  current.points[0].startLine = 999;
  equal([...current.getDocument(first.document).hash], originalHash, 'Owned snapshot document hash');
  equal(current.points, updated.points, 'Owned snapshot points');
  rejects(() => revisions.capture({ ...frame, generation: 2 }), 'PDB_METHOD_REVISION_MISMATCH');
  rejects(() => revisions.capture({ ...frame, generation: undefined }), 'PDB_GENERATION_MISMATCH');
  rejects(() => revisions.capture({ ...frame, baselineId: '0'.repeat(40) }), 'PDB_BASELINE_MISMATCH');
  history.dispose();
  equal(old.points, before.points, 'Owned snapshot survives provider disposal');
  rejects(() => revisions.capture(frame), 'PDB_GENERATIONS_DISPOSED');
  revisions.dispose();
  rejects(() => old.location(0), 'PDB_SYMBOL_SNAPSHOT_DISPOSED');
  rejects(() => revisions.capture(frame), 'PDB_REVISION_MAP_DISPOSED');
  checks.push('Exact frame revision identity, unchanged methods, immutable copied maps and provider/map disposal');

  const cancelled = new AbortController();
  cancelled.abort();
  const delta = deltas[0];
  rejects(() => readPortablePdbDelta(delta.bytes, { typeSystemRowCounts: delta.typeSystemRowCounts,
    signal: cancelled.signal }), /cancelled/);
  rejects(() => readPortablePdbDelta(delta.bytes, { typeSystemRowCounts: delta.typeSystemRowCounts, budgets: { methods: 2 } }), /budget/);
  const malformed = delta.bytes.slice();
  const metadata = readMetadata(malformed);
  new DataView(malformed.buffer).setUint32(metadata.tableOffset + metadata.rowOffsets[31][0], 0, true);
  rejects(() => readPortablePdbDelta(malformed, { typeSystemRowCounts: delta.typeSystemRowCounts }), 'PDB_DELTA_MAP');
  const bounded = new PortablePdbGenerations(baseline, { maxGenerations: 1 });
  rejects(() => bounded.append(delta.bytes, { baselineId: bounded.baselineId, previousPdbId: bounded.pdbId,
    generation: 1, typeSystemRowCounts: delta.typeSystemRowCounts }), 'PDB_GENERATION_BUDGET');
  const boundedMap = new PortablePdbRevisionMap(bounded, { maxSnapshots: 2, maxPoints: before.points.length, maxDocuments: 1 });
  const firstLease = boundedMap.capture(frame);
  const secondLease = boundedMap.capture(frame);
  rejects(() => boundedMap.capture(frame), 'PDB_REVISION_BUDGET');
  firstLease.dispose();
  rejects(() => boundedMap.capture(frame, { signal: cancelled.signal }), 'PDB_REVISION_CANCELLED');
  const other = { ...frame, methodToken: reference.generations[0].symbols.methods[0].token };
  rejects(() => boundedMap.capture(other), 'PDB_REVISION_BUDGET');
  secondLease.dispose();
  assert(boundedMap.capture(other).points.length === 1, 'Cache budget was not released');
  boundedMap.dispose();
  bounded.dispose();
  checks.push('Malformed native EnC map, cancellation, aggregate reader/generation limits and shared snapshot cache leases');

  const written = await (await request(writtenCorpus, 'reference.json')).json();
  const accepted = await artifact(writtenCorpus, 'written.pdb', written.sha256);
  const deltaMetadata = readMetadata(await artifact(corpus, 'delta1.dmeta', reference.artifacts['delta1.dmeta']));
  const deltaCounts = Object.fromEntries(Object.entries(deltaMetadata.counts).filter(([table]) => +table < 48 && +table !== 30 && +table !== 31));
  equal(deltaCounts, written.envelope.deltaRowCounts, 'Physical delta counts from native CLI delta');
  equal(delta.typeSystemRowCounts, written.envelope.typeSystemRowCounts, 'Authoritative aggregate CLI counts');
  const input = writerInput(delta);
  const output = emitPortablePdbDelta(input, written.envelope);
  equal([...output.bytes], [...accepted], 'Browser-emitted bytes differ from native SRM-accepted delta');
  const parsed = readPortablePdbDelta(output.bytes, { typeSystemRowCounts: output.typeSystemRowCounts });
  compareNative(parsed, written.native);
  equal(parsed.constants.map(({ name, signature }) => ({ name, signature: hex(signature) })), written.native.constants, 'Native constants');
  equal(parsed.custom.map((record, index) => ({ parent: decodeCoded('HasCustomDebugInformation', parsed.metadata.rows[55][index][0]),
    kind: record.kind, bytes: hex(record.bytes) })), written.native.custom, 'Native delta-local CDI parents and opaque payload');
  assert(parsed.custom[0].parent === updated.token, 'Aggregate CDI parent');
  const writtenHistory = new PortablePdbGenerations(baseline);
  writtenHistory.append(output.bytes, output);
  equal(writtenHistory.getMethodByVersion(updated.token, 2).points, input.methods[0].points, 'Browser writer history readback');
  writtenHistory.dispose();
  rejects(() => emitPortablePdbDelta(input, written.envelope, { signal: cancelled.signal }), 'PDB_DELTA_CANCELLED');
  rejects(() => emitPortablePdbDelta(input, written.envelope, { maxPoints: 0 }), 'PDB_DELTA_BUDGET');
  rejects(() => emitPortablePdbDelta(input, { ...written.envelope, deltaRowCounts: { 6: 2 } }), 'PDB_DELTA_COUNTS');
  for (const stateMachines of [[null], [{ moveNext: updated.token, kickoff: 0x100000000 + updated.token }]]) {
    rejects(() => emitPortablePdbDelta({ ...input, stateMachines }, written.envelope), 'PDB_DELTA_INPUT');
  }
  rejects(() => emitPortablePdbDelta({ ...input, custom: [{ ...input.custom[0], parent: 0x100000000 + updated.token }] },
    written.envelope), 'PDB_DELTA_INPUT');
  checks.push('Browser emission matches captured native SRM-accepted bytes; methods/scopes/constants/CDI and readback equality',
    'Writer cancellation, point budget, physical/aggregate row-count distinction and malformed token diagnostics');
  return { passed: true, checks, nativeReference: { sdk: written.sdk, runtime: written.runtime,
    compiler: reference.compiler, writerSha256: written.sha256 }, nativeInvocation: false, managedApplyUpdate: false };
}
