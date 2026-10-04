import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { clean, git, sha } from '../../../scripts/conformance/perf/core.js';

export const baselineCommit = '75f0caad1c3ea096a656feb2989b867781edc82f';
export const productCommit = '6e3d26f3ec6abe54699fce1caefa57e9a5c569f5';
export const workloads = Object.freeze([
  { id: 'small', operations: 128 }, { id: 'dense96', operations: 32 }, { id: 'il', operations: 64 },
  { id: 'r2r', operations: 25 }, { id: 'mixed', operations: 25 },
]);
export const toolPaths = Object.freeze([
  'packages/cil/tools/benchmark-pe-bounds.mjs', 'packages/cil/tools/pe-bounds-benchmark-worker.mjs',
  'packages/cil/tools/pe-bounds-benchmark-shared.mjs', 'scripts/conformance/perf/core.js',
  'scripts/conformance/oracle/process.js', 'scripts/limited.js', 'scripts/conformance/static/allowlist.json',
  'tests/fixtures/pe-bounds/input.mjs', 'tests/fixtures/pe-bounds/verify.mjs',
  'tests/fixtures/pe-inspection/reference-images.json',
]);

export function toolHashes(root) {
  return Object.fromEntries(toolPaths.map(path => [path, sha(readFileSync(resolve(root, path)))]));
}

export function sourceIdentity(root, side, revisions = { baselineCommit, productCommit }) {
  assert.ok(side === 'baseline' || side === 'candidate', 'Measured checkout side');
  assert.deepEqual(Object.keys(revisions).sort(), ['baselineCommit', 'productCommit']);
  for (const value of Object.values(revisions)) assert.match(value, /^[a-f0-9]{40}$/, 'Exact source revision');
  root = realpathSync(root);
  const head = clean(root), expected = side === 'baseline' ? revisions.baselineCommit : revisions.productCommit;
  if (side === 'baseline') assert.equal(head, expected);
  else git(root, 'merge-base', '--is-ancestor', expected, head);
  git(root, 'diff', '--exit-code', expected, '--', ':(glob)packages/*/src/**', ':(glob)packages/*/package.json', 'package.json');
  const packages = [];
  for (const name of ['cil', 'bytecode', 'framework', 'bcl-core', 'bcl-collections']) {
    const directory = 'packages/' + name;
    const entry = realpathSync(createRequire(resolve(root, 'package.json')).resolve('@sharpforge/' + name));
    assert.equal(entry, resolve(root, directory, 'src/index.js'), 'Own public alias: ' + name);
    const paths = git(root, 'ls-files', '--', directory + '/src', directory + '/package.json').split('\n');
    const files = Object.fromEntries(paths.map(path => [path, sha(readFileSync(resolve(root, path)))]));
    packages.push({ name, entry, sourceTree: git(root, 'rev-parse', 'HEAD:' + directory + '/src'),
      sha256: sha(JSON.stringify(files)), files });
  }
  return { root, side, head, productCommit: expected, packages };
}

/** Complete raw-reader data facts, preserving key order/undefined values and hashing borrowed byte sequences. */
export function readerFacts(pe, bytes) {
  assert.equal(pe.bytes, bytes, 'readPE keeps its existing borrowed input');
  const fields = JSON.stringify(pe, (_, value) => {
    if (value === undefined) return { type: 'undefined' };
    if (typeof value === 'function') return { type: 'function' };
    if (typeof value === 'bigint') return { type: 'bigint', value: value.toString() };
    if (value instanceof Uint8Array) return { type: 'bytes', bytes: value.length, sha256: sha(value) };
    if (value instanceof Map) return { type: 'map', entries: [...value] };
    return value;
  });
  const offsets = pe.sections.filter(section => section.size).map(section =>
    [pe.offsetOf(section.rva, section.size), pe.offsetOf(section.rva + section.size - 1, 1)]);
  return { fieldsSha256: sha(fields), offsets, sectionCount: pe.sections.length,
    imageKind: pe.imageKind, moduleName: pe.metadata.string(pe.metadata.rows[0][0][1]) };
}
