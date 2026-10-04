import assert from 'node:assert/strict';
import * as candidate from '@sharpforge/cil';
import { arithmeticLibrary } from '../../../tests/managed-fixtures.js';
import { compareReference } from '../../../tests/fixtures/pe-inspection/comparison.mjs';
import { sha } from '../../../scripts/conformance/perf/core.js';

const metadataOptions = Object.freeze({ includeMethods: false });

// Preserve undefined/UInt64 values and hash byte sequences without retaining their payloads.
function dataFacts(value) {
  if (value === undefined) return { valueType: 'undefined' };
  if (typeof value === 'bigint') return { valueType: 'bigint', hex: `0x${value.toString(16)}` };
  if (typeof value === 'function') return { valueType: 'function' };
  if (value instanceof Uint8Array) return { valueType: 'bytes', bytes: value.length, sha256: sha(value) };
  if (value instanceof Map) return { valueType: 'Map', entries: [...value].map(dataFacts) };
  if (Array.isArray(value)) return value.map(dataFacts);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, dataFacts(item)]));
  return value;
}

const digest = value => sha(JSON.stringify(dataFacts(value)));

function completeFacts(library, bytes) {
  const pe = library.readPE(bytes);
  const inspector = new library.AssemblyInspector(bytes);
  const tokens = [...inspector.methods.keys()];
  const methods = tokens.map(token => inspector.getMethod(token));
  for (const method of methods) assert.equal(inspector.getMethod(method.token), method, 'Public method cache identity');
  return dataFacts({ pe, bodies: tokens.map(token => ({ token, body: pe.methodBody(token) })),
    offsets: pe.sections.map(section => pe.offsetOf(section.rva, section.size)),
    fullSummary: inspector.summary(), metadataSummary: inspector.summary(metadataOptions),
    pages: tokens.map((token, methodOffset) => inspector.summary({ methodOffset, methodLimit: 1 })),
    methods, disassembly: library.disassembleAssembly(bytes), listing: library.formatAssembly(bytes) });
}

// Compare every baseline key, including undefined-valued fields. Additive candidate output remains explicit.
function preserveLegacy(actual, expected, additions, path = '$') {
  if (expected === null || typeof expected !== 'object') {
    assert.deepEqual(actual, expected, `${path}: legacy value`);
    return;
  }
  assert.ok(actual && typeof actual === 'object', `${path}: legacy record`);
  assert.equal(Array.isArray(actual), Array.isArray(expected), `${path}: legacy container`);
  if (Array.isArray(expected)) assert.equal(actual.length, expected.length, `${path}: legacy array length`);
  for (const key of Object.keys(expected)) {
    assert.ok(Object.hasOwn(actual, key), `${path}.${key}: missing legacy field`);
    preserveLegacy(actual[key], expected[key], additions, `${path}.${key}`);
  }
  for (const key of Object.keys(actual)) {
    if (!Object.hasOwn(expected, key)) additions.push({ path: `${path}.${key}`, value: actual[key] });
  }
}

function ordinaryVariants(libraries, bytes, expected, operation) {
  return Object.entries(libraries).map(([id, library]) => {
    const inspector = new library.AssemblyInspector(bytes);
    inspector.summary();
    const operations = {
      readPE: () => library.readPE(bytes),
      coldSummary: () => new library.AssemblyInspector(bytes).summary(),
      warmMetadataSummary: () => inspector.summary(metadataOptions),
    };
    const key = { readPE: 'pe', coldSummary: 'fullSummary', warmMetadataSummary: 'metadataSummary' }[operation];
    return { id, invoke: operations[operation],
      guard: actual => assert.deepEqual(dataFacts(actual), expected[id][key], `${id} ${operation}: complete result`),
      expectedSha256: sha(JSON.stringify(expected[id][key])) };
  });
}

/** One common CIL input and all existing reader, inspector and listing facts, independent of timed batches. */
export function ordinaryWorkloads(baseline) {
  const libraries = { baseline, candidate };
  const bytes = arithmeticLibrary();
  const imageSha256 = sha(bytes);
  const expected = Object.fromEntries(Object.entries(libraries)
    .map(([id, library]) => [id, completeFacts(library, bytes)]));
  const additions = [];
  preserveLegacy(expected.candidate, expected.baseline, additions);
  assert.equal(expected.baseline.fullSummary.name, 'Arithmetic');
  assert.deepEqual(expected.baseline.methods.map(method => method.name), ['Add', 'Square', 'Hello']);
  assert.deepEqual(expected.baseline.methods.map(method => method.instructions.length), [4, 4, 3]);
  assert.ok(expected.baseline.methods.every(method => method.hasBody && method.codeSize > 0));
  const counts = { readPE: 200, coldSummary: 100, warmMetadataSummary: 500 };
  const workloads = Object.entries(counts).map(([operation, iterations]) => ({
    id: operation, group: 'ordinary', iterations, variants: ordinaryVariants(libraries, bytes, expected, operation),
  }));
  const evidence = { fixture: 'tests/managed-fixtures.js#arithmeticLibrary', imageBytes: bytes.length, imageSha256,
    methods: 3, instructions: 11, preexistingFactsCompared: [
      'Every public readPE data field, including metadata, all headers, sections, directories, and CLI fields',
      'Section RVA callbacks, every raw CIL body, and public cached method identity',
      'Complete full/metadata-only/paged summaries and every public method record',
      'Complete disassembleAssembly result and exact formatAssembly text',
    ], baselineFactsSha256: sha(JSON.stringify(expected.baseline)),
    candidateFactsSha256: sha(JSON.stringify(expected.candidate)), additionalCandidateFacts: additions };
  return { workloads, evidence, verify() {
    assert.equal(sha(bytes), imageSha256, 'Common input bytes changed');
    for (const [id, library] of Object.entries(libraries))
      assert.deepEqual(completeFacts(library, bytes), expected[id], `${id}: post-timing complete legacy facts`);
  } };
}

function comparePinned(bytes, native, id) {
  const comparison = compareReference(bytes, native);
  assert.equal(comparison.differences.length, 0, `${id}: PEReader/SRM comparison failed`);
  assert.equal(comparison.comparisons.length, 8, `${id}: complete native comparison coverage`);
  assert.ok(comparison.comparisons.every(value => value.status === 'pass'), `${id}: native comparison verdicts`);
  return comparison;
}

/** New API cost only: inspectPE parses each actual image; reference comparison and payload hashes stay outside timing. */
export function referenceWorkload({ definition, bytes, native }) {
  const { id, sha256, expectedImageKind } = definition;
  assert.equal(bytes.length, definition.bytes, `${id}: pinned image length`);
  assert.equal(sha(bytes), sha256, `${id}: pinned image SHA256`);
  const comparison = comparePinned(bytes, native, id);
  const snapshot = candidate.inspectPE(bytes);
  assert.equal(snapshot.imageKind, expectedImageKind, `${id}: actual image classification`);
  const expectedSha256 = digest(snapshot);
  const guard = actual => assert.equal(digest(actual), expectedSha256, `${id}: complete inspectPE snapshot hash`);
  return { workload: { id: `inspectPE-${id}`, group: 'new-feature', iterations: 25,
    variants: [{ id: 'candidate', invoke: () => candidate.inspectPE(bytes), guard, expectedSha256 }] },
    evidence: { reference: definition, comparison, snapshotSha256: expectedSha256,
      dimensions: { imageKind: snapshot.imageKind, sections: snapshot.sections.length, directories: snapshot.directories.length,
        debugRecords: snapshot.debugDirectory.length,
        debugPayloadBytes: snapshot.debugDirectory.reduce((sum, record) => sum + record.payload.length / 2, 0),
        publicKeyBytes: snapshot.strongName.publicKey.length / 2, signatureBytes: (snapshot.strongName.signature?.length ?? 0) / 2 },
      interpretation: 'New inspectPE cost, including input parsing and owned output; no equivalent baseline API is measured.' },
    verify() {
      assert.equal(sha(bytes), sha256, `${id}: pinned image changed`);
      guard(candidate.inspectPE(bytes));
      assert.deepEqual(comparePinned(bytes, native, id), comparison, `${id}: post-timing native facts`);
    } };
}
