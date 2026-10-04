import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {sourceFiles} from '../scripts/conformance/static/check-imports.js';

const repository = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, repository));
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

function relocationChain() {
  const chain = JSON.parse(read('planning/qualification/a05-evidence-relocations/chain.json'));
  assert.equal(chain.format, 'SharpForge.A05EvidenceRelocationChain/1');
  const maps = [chain.initial, ...chain.followups].map((entry, index, entries) => {
    const bytes = read(entry.path);
    assert.equal(digest('sha256', bytes), entry.sha256, entry.path);
    const map = JSON.parse(bytes);
    assert.equal(map.format, 'SharpForge.A05EvidenceRelocation/1');
    assert.equal(map.fileCount, map.files.length);
    assert.equal(map.bytes, map.files.reduce((sum, row) => sum + row.bytes, 0));
    if (index) {
      assert.equal(map.predecessorManifest, entries[index - 1].path);
      assert.equal(map.predecessorManifestSHA256, entries[index - 1].sha256);
    }
    return map;
  });
  const moves = new Map();
  for (const map of maps.slice(1)) for (const row of map.files) {
    assert.ok(!moves.has(row.oldPath), 'duplicate relocation source');
    assert.ok(row.newPath.startsWith('planning/qualification/a05-evidence/'));
    assert.ok(!row.newPath.split('/').includes('..'));
    moves.set(row.oldPath, row);
  }
  return {initial: maps[0], moves};
}

function resolveEvidence(row, moves) {
  let path = row.newPath;
  const visited = new Set();
  while (moves.has(path)) {
    assert.ok(!visited.has(path), 'cyclic evidence relocation');
    visited.add(path);
    const next = moves.get(path);
    for (const key of ['mode', 'gitBlob', 'sha256', 'bytes']) {
      assert.equal(next[key], row[key], 'relocation changed identity: ' + key);
    }
    path = next.newPath;
  }
  return path;
}

test('A05 shipped documentation contains the small source-host index instead of raw qualification assets', () => {
  const directory = new URL('docs/a05-evidence/', repository);
  assert.deepEqual(readdirSync(directory), ['README.md']);
  const index = read('docs/a05-evidence/README.md');
  assert.ok(index.length < 8192, 'the shipped index must stay small');
  assert.match(index.toString(), /https:\/\/github\.com\/wieslawsoltes\/SharpForge\//);
});

test('A05 evidence relocation preserves every original Git blob, SHA-256 and byte count', () => {
  const {initial: manifest, moves} = relocationChain();
  assert.equal(manifest.fileCount, manifest.files.length);
  assert.equal(new Set(manifest.files.map(row => row.oldPath)).size, manifest.fileCount);
  assert.equal(new Set(manifest.files.map(row => row.newPath)).size, manifest.fileCount);
  let total = 0;
  for (const row of manifest.files) {
    assert.equal(row.newPath, manifest.destinationPrefix + row.oldPath.slice(manifest.sourcePrefix.length));
    assert.ok(row.oldPath.startsWith(manifest.sourcePrefix));
    assert.ok(!row.newPath.split('/').includes('..'));
    const bytes = read(resolveEvidence(row, moves));
    assert.equal(bytes.length, row.bytes, row.newPath);
    assert.equal(digest('sha256', bytes), row.sha256, row.newPath);
    const object = Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]);
    assert.equal(digest('sha1', object), row.gitBlob, row.newPath);
    total += bytes.length;
  }
  assert.equal(total, manifest.bytes);
});

test('historical drivers remain text evidence outside the unchanged executable module inventory', () => {
  const {initial, moves} = relocationChain();
  assert.equal(moves.size, 3);
  for (const [path] of moves) {
    const row = initial.files.find(item => item.newPath === path);
    assert.ok(row, 'every follow-up starts from an original mapped blob');
    assert.equal(resolveEvidence(row, moves), path + '.txt');
  }
  const files = sourceFiles(fileURLToPath(repository), ['planning/qualification/a05-evidence']);
  assert.deepEqual(files, [], 'raw command captures must not become runnable repository modules');
});

test('relocation chains reject a forged identity or a cycle instead of hiding a changed artifact', () => {
  const {initial, moves} = relocationChain();
  const first = [...moves.values()][0];
  const row = initial.files.find(item => item.newPath === first.oldPath);
  const forged = new Map(moves).set(first.oldPath, {...first, sha256: '0'.repeat(64)});
  assert.throws(() => resolveEvidence(row, forged), /relocation changed identity/);
  const cyclic = new Map(moves).set(first.newPath, {...first, oldPath: first.newPath, newPath: first.oldPath});
  assert.throws(() => resolveEvidence(row, cyclic), /cyclic evidence relocation/);
});
