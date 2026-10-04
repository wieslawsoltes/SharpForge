import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha } from '../../../scripts/conformance/perf/core.js';
import { assertPins } from '../../../scripts/conformance/oracle/toolchain.js';
import { verifyBoundsCapture } from './verify.mjs';

const fixtureAuthorities = Object.freeze([
  'tests/fixtures/pe-bounds/input.mjs',
  'tests/fixtures/pe-bounds/contracts.mjs',
  'tests/fixtures/pe-bounds/Program.cs',
  'tests/fixtures/pe-bounds/verify.mjs',
  'tests/fixtures/pe-inspection/Program.cs',
  'tests/fixtures/pe-inspection/comparison.mjs',
  'tests/fixtures/pe-inspection/reference-images.json',
  'tests/fixtures/decompiler-cfg/native.json',
  'planning/qualification/oracle-toolchain.json',
]);

/** Validate historical native provenance; current product behavior is replayed separately over authored bytes. */
export function verifyBoundsReplay(directory) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const record = verifyBoundsCapture(directory, { strictSource: false });
  assert.equal(record.schemaVersion, 1);
  assert.match(record.sourceCommit, /^[a-f0-9]{40}$/, 'Historical capture source commit');
  assert.ok(Object.keys(record.sourceSha256).length > 10, 'Historical source inventory');
  for (const [path, hash] of Object.entries(record.sourceSha256)) {
    assert.ok(/^(packages|scripts|tests|planning)\//.test(path), 'Owned historical source path');
    assert.ok(!path.includes('\\') && path.split('/').every(part => part && part !== '.' && part !== '..'));
    assert.match(hash, /^[a-f0-9]{64}$/, path);
  }
  for (const path of fixtureAuthorities) {
    assert.match(record.sourceSha256[path], /^[a-f0-9]{64}$/, 'Captured fixture authority: ' + path);
    assert.equal(sha(readFileSync(resolve(root, path))), record.sourceSha256[path], 'Unchanged fixture authority: ' + path);
  }
  assertPins(record.toolchain, undefined, record.environment.platform);
  return record;
}
