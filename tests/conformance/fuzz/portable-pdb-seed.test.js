import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPortablePdb } from '@sharpforge/symbols';
import { inputDigest, writeFinding } from '../../../scripts/conformance/fuzz/corpus.js';
import { runCase } from '../../../scripts/conformance/fuzz/harness.js';
import { target } from '../../../scripts/conformance/fuzz/targets/portable-pdb.js';
import {
  createPinnedPortablePdbSeed, pinnedPortablePdb, verifyPinnedPortablePdb,
} from '../../../scripts/conformance/fuzz/targets/portable-pdb-pinned-seed.js';
import { createPortablePdbBoundarySeeds } from '../../../scripts/conformance/fuzz/targets/portable-pdb-seeds.js';

test('Portable PDB target includes the unchanged licensed .NET runtime document fixture', () => {
  const seeds = target.createSeeds();
  const seed = seeds.find(value => value.name === 'dotnet-documents');
  assert(seed);
  assert.equal(seed.input.length, 712);
  assert.equal(inputDigest(seed.input), 'fc1f588948504f3ad379af668dbddeab21e0a27f117c66ded6fba61b85d9f701');
  assert.equal(pinnedPortablePdb.gitBlob, 'ee0a1421085feeebf829e4f3b0ad972cc2e9c22c');
  assert.equal(pinnedPortablePdb.license, 'MIT');
  verifyPinnedPortablePdb(seed.input);
  const symbols = readPortablePdb(seed.input, { maxBytes: 712, maxSourceBytes: 65536 });
  assert.equal(symbols.documents.length, 13);
  assert.equal(symbols.documents[0].name, 'C:\\Documents.cs');
  assert.equal(symbols.documents[11].name, 'C:\\a\\b\\X.cs');
  assert.equal(symbols.methods[0].points.length, 16);
  assert.equal(symbols.location(0x06000001, 29), null);
  assert.equal(symbols.location(0x06000001, 35).startLine, 50);
  assert(seeds.reduce((bytes, value) => bytes + value.input.length, 0) <= 65536);
});

test('Portable PDB pin rejects changed size/content and supports offset views without sharing writable data', () => {
  const first = createPinnedPortablePdbSeed();
  const retained = first.input.slice();
  const padded = new Uint8Array(retained.length + 2);
  padded.set(retained, 1);
  verifyPinnedPortablePdb(padded.subarray(1, -1));
  assert.throws(() => verifyPinnedPortablePdb(retained.subarray(1)), /size changed/);
  assert.throws(() => verifyPinnedPortablePdb({}), TypeError);
  first.input[0] ^= 1;
  assert.throws(() => verifyPinnedPortablePdb(first.input), /digest changed/);
  assert.deepEqual(createPinnedPortablePdbSeed().input, retained);
});

test('Portable PDB boundary cases are deterministic independent copies below one KiB', () => {
  const first = createPortablePdbBoundarySeeds();
  const second = createPortablePdbBoundarySeeds();
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(seed => seed.name)).size, 3);
  for (let index = 0; index < first.length; index++) {
    assert(first[index].input.length <= 1024);
    const retained = second[index].input.slice();
    first[index].input[0] ^= 1;
    assert.deepEqual(second[index].input, retained);
  }
});

test('Portable PDB row-index and compression-size failures are controlled under existing process budgets', async () => {
  for (const seed of createPortablePdbBoundarySeeds().filter(value => value.name !== 'invalid-compression-block')) {
    const result = await runCase({ targetId: 'portable-pdb', input: seed.input, seed: 1146 });
    assert.equal(result.status, 'rejected', seed.name);
    assert.equal(result.code, 'PORTABLE_PDB_VALIDATION');
    assert.equal(result.budgets.maxInputBytes, 65536);
    assert.equal(result.isolation.v8OldSpaceMb, 128);
  }
});

test('Portable PDB reserved DEFLATE errors remain recorded findings rather than controlled rejections', async () => {
  // #1146: this verifies harness classification of the existing symbol-reader contract gap, not PDB conformance.
  const seed = createPortablePdbBoundarySeeds().find(value => value.name === 'invalid-compression-block');
  const result = await runCase({ targetId: 'portable-pdb', input: seed.input, seed: 1146 });
  assert.equal(result.status, 'finding');
  assert.equal(result.finding.kind, 'unexpected-error');
  assert.match(result.finding.detail, /Reserved DEFLATE block/);
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-pdb-finding-'));
  try {
    const path = await writeFinding(directory, result, seed.input);
    const record = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(record.inputSHA256, result.inputSHA256);
    assert.equal(record.originalFinding.kind, 'unexpected-error');
    assert.deepEqual(record.expectedStatuses, ['accepted', 'rejected']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
