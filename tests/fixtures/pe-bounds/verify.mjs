import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha } from '../../../scripts/conformance/perf/core.js';

/** Verify retained native source identity and every raw workload result without importing product code. */
export function verifyBoundsCapture(directory, { strictSource = true } = {}) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const record = JSON.parse(readFileSync(resolve(directory, 'native.json')));
  assert.equal(record.status, 'completed');
  assert.equal(record.toolchain.sdk, '10.0.201');
  assert.equal(record.toolchain.runtime, '10.0.5');
  assert.deepEqual(record.commands.map(command => command.label), [
    'build-BoundsObserver', 'observe-authored', 'build-PEObserver', 'observe-il', 'observe-r2r', 'observe-mixed',
  ]);
  if (strictSource) for (const [path, expected] of Object.entries(record.sourceSha256))
    assert.equal(sha(readFileSync(resolve(root, path))), expected, 'Native source identity: ' + path);
  for (const command of record.commands) {
    assert.equal(command.result.exitCode, 0);
    assert.equal(command.result.signal, null);
    for (const stream of ['stdout', 'stderr']) {
      const bytes = readFileSync(resolve(directory, command.label + '.' + stream + '.log'));
      assert.equal(sha(bytes), command[stream + 'Sha256']);
      assert.equal(bytes.toString(), command.result[stream]);
    }
  }
  const authored = JSON.parse(readFileSync(resolve(directory, 'observe-authored.stdout.log'))).results;
  assert.equal(record.authored.length, authored.length);
  record.authored.forEach((row, index) => {
    assert.equal(row.id, authored[index].id);
    assert.deepEqual(row.native, authored[index].observation);
  });
  assert.deepEqual(record.references.map(row => row.id), ['il', 'r2r', 'mixed']);
  for (const row of record.references) {
    assert.deepEqual(row.native, JSON.parse(readFileSync(resolve(directory, 'observe-' + row.id + '.stdout.log'))));
    assert.equal(row.imageSha256, row.native.image.sha256);
    assert.equal(row.imageBytes, row.native.image.bytes);
    assert.deepEqual(row.comparison.differences, []);
  }
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Usage: verify.mjs <capture-directory>');
  const record = verifyBoundsCapture(resolve(process.argv[2]));
  console.log(JSON.stringify({ status: 'verified', authored: record.authored.length, references: record.references.length }));
}
