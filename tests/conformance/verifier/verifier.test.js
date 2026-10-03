import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { compileToIL } from '@sharpforge/compiler';
import { loadCorpus, validateCases, parseILVerify, checkOracle, validateCapture, ruleTable } from '../../../scripts/conformance/verifier/catalog.js';
import { methodPattern } from '../../../scripts/conformance/verifier/capture.js';
import { verifyCandidate } from '../../../scripts/conformance/verifier/candidate.js';
import { verifierPin, checkTools } from '../../../scripts/conformance/verifier/tools.js';
import { reportVerifier } from '../../../scripts/conformance/verifier/report.js';

import { pin } from '../../../scripts/conformance/oracle/toolchain.js';

const catalog = await loadCorpus();

test('Verifier fixtures retain real upstream provenance and an accepting/rejecting pair per tracked rule', () => {
  assert.equal(catalog.upstream.commit, '081d220c0a773ffb7c6bea6b48727833576a65ef');
  assert.equal(catalog.upstream.license, 'MIT');
  assert(catalog.upstream.cases.length >= 317);
  assert(catalog.upstream.diagnostics.length >= 100);
  assert.equal(validateCases(catalog.cases).size, 93);
  assert.throws(() => validateCases([]), /size/);
  assert.throws(() => validateCases(catalog.cases.slice(1)), /accepting and rejecting/);
  assert.throws(() => validateCases([...catalog.cases, catalog.cases[0]]), /Duplicate/);
  const changed = structuredClone(catalog.cases);
  changed[0].source = '../outside.il';
  assert.throws(() => validateCases(changed), /IL identity/);
});

test('ILVerify parser distinguishes acceptance, rule rejection, tool failure and empty selection', () => {
  const result = { exitCode: 0, signal: null, stdout: 'Methods verified: 1\n', stderr: '' };
  assert.deepEqual(parseILVerify(result), { accepted: true, errors: [] });
  const rejected = { ...result, exitCode: 2, stdout: '[IL]: Error [StackUnderflow]: details\nMethods verified: 1\n' };
  assert.deepEqual(parseILVerify(rejected), { accepted: false, errors: ['StackUnderflow'] });
  for (const change of [
    { exitCode: 1 }, { signal: 'SIGTERM' }, { stdout: 'Methods verified: 0\n' },
    { stdout: 'Methods verified: 2\n' }, { stdout: '' }, { exitCode: 2 },
    { stdout: '[IL]: Error [StackUnderflow]: error\nMethods verified: 1\n' },
  ]) assert.throws(() => parseILVerify({ ...result, ...change }));
  const fixture = catalog.cases.find(row => row.id === 'stack-underflow-reject');
  assert(checkOracle(fixture, parseILVerify(rejected)));
  assert(!checkOracle(fixture, { accepted: false, errors: ['ReturnVoid'] }));
});

// Synthetic captures validate the envelope only. They are never oracle evidence.
function syntheticCapture() {
  return { schemaVersion: 1, oracle: 'ilverify', version: verifierPin.version,
    inventoryHash: catalog.inventoryHash, sanityChecks: false,
    target: 'darwin-arm64', sdk: pin.sdk, runtime: pin.runtime, references: pin.referenceAssemblies,
    toolSHA256: verifierPin.files.find(file => file.path === verifierPin.entry).sha256,
    cases: catalog.cases.map(row => ({ id: row.id, inputHash: row.inputHash, assemblySHA256: 'a'.repeat(64),
      oracle: { accepted: row.polarity === 'accept', errors: row.expectedErrors } })) };
}

test('Verifier evidence rejects stale, duplicate, unpinned or incorrectly rejected captures', () => {
  assert.doesNotThrow(() => validateCapture(syntheticCapture(), catalog, verifierPin));
  for (const change of [
    capture => { capture.version = '0'; },
    capture => { capture.toolSHA256 = 'b'.repeat(64); },
    capture => { capture.cases.pop(); },
    capture => { capture.cases[0] = capture.cases[1]; },
    capture => { capture.cases[0].inputHash = 'b'.repeat(64); },
    capture => { capture.cases[0].oracle.accepted = false; },
    capture => { capture.cases[0].oracle.errors = ['ReturnVoid']; },
    capture => { capture.target = 'unknown'; },
    capture => { capture.sanityChecks = true; },
    capture => { capture.inventoryHash = '0'.repeat(64); },
    capture => { capture.cases[1].oracle.errors = []; },
  ]) {
    const capture = structuredClone(syntheticCapture());
    change(capture);
    assert.throws(() => validateCapture(capture, catalog, verifierPin));
  }
});

test('Candidate uses the public constrained CIL verifier and separates unreadable input', () => {
  const compiled = compileToIL('class Test { public static int Run() { return 42; } static void Main() { Run(); } }');
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  const observed = verifyCandidate(compiled.assembly);
  assert.equal(observed.status, 'observed');
  assert.equal(observed.accepted, true);
  assert.equal(verifyCandidate(Uint8Array.of(0, 1, 2)).status, 'unsupported');
  assert.equal(verifyCandidate(compiled.assembly, 'Absent::Run').status, 'unsupported');
});

test('Unavailable tools and missing oracle reports never become passing agreement', async () => {
  assert.equal((await checkTools()).supported, false);
  const output = await mkdtemp(path.join(os.tmpdir(), 'verifier-report-'));
  try {
    const rows = await reportVerifier({ output });
    assert(rows.every(row => row.status === 'missing-oracle'));
    const report = JSON.parse(await readFile(path.join(output, 'results.json')));
    assert(report.unsupported.some(row => row.engine === 'rust-wasm'));
    assert(ruleTable(catalog).includes('metadata-or-encoding'));
    assert(ruleTable(catalog).includes('not run'));
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('Every mapped verification diagnostic has paired constraints without padding repeated methods', () => {
  const ids = new Set(catalog.rules.map(row => row.id));
  assert.equal(ids.size, 93);
  const relevant = catalog.inventory.diagnostics.filter(row => row.classification === 'partition-iii');
  assert.equal(relevant.length, 95);
  assert(relevant.every(row => row.rules.length > 0 && row.rules.every(id => ids.has(id))));
  const unique = new Set(catalog.cases.map(row => JSON.stringify([row.sha256, row.method, row.polarity, row.expectedErrors])));
  assert.equal(unique.size, catalog.cases.length);
  assert.equal(catalog.inventory.diagnostics.filter(row => row.classification === 'metadata-or-encoding').length, 14);
  assert.equal(catalog.inventory.diagnostics.filter(row => row.classification === 'optional-sanity').length, 1);
  assert.equal(catalog.inventory.diagnostics.filter(row => row.classification === 'instruction-correctness').length, 1);
});

test('Native method filters quote literal upstream names and constructor punctuation', () => {
  const simple = new RegExp(methodPattern('Test::Run'));
  assert(simple.test('[assembly]Test.Run'));
  assert(!simple.test('[assembly]TestXRun'));
  const constructor = new RegExp(methodPattern('Test::.ctor'));
  assert(constructor.test('[assembly]Test..ctor'));
  const upstream = new RegExp(methodPattern('Leave.ToSameFilter_Valid'));
  assert(upstream.test('[assembly]ExceptionRegionTests.Leave.ToSameFilter_Valid'));
  assert(!upstream.test('[assembly]ExceptionRegionTests.LeaveXToSameFilter_Valid'));
});
