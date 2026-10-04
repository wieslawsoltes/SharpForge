import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
import { clean, git, sha } from '../../../scripts/conformance/perf/core.js';
import { baselineCommit, fixturePins, productCommit, toolPaths } from './metadata-generations-benchmark-protocol.mjs';

function sourceFiles(directory) {
  const rows = [];
  const visit = parent => {
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const path = resolve(parent, entry.name);
      assert.ok(!entry.isSymbolicLink(), 'Package source must not alias another checkout');
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) rows.push({ path: relative(directory, path).replaceAll('\\', '/'), sha256: sha(readFileSync(path)) });
    }
  };
  visit(directory);
  return rows.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

/** Read source identity and resolve public aliases without importing any product module. */
export function benchmarkCheckout(root, side) {
  assert.ok(side === 'baseline' || side === 'candidate', 'Known comparison side');
  root = realpathSync(root);
  const head = clean(root), expected = side === 'baseline' ? baselineCommit : productCommit;
  if (side === 'baseline') assert.equal(head, expected, 'Exact pre-reader-seam baseline');
  else git(root, 'merge-base', '--is-ancestor', expected, head);
  git(root, 'diff', '--exit-code', expected, '--', ':(glob)packages/*/src/**', ':(glob)packages/*/package.json', 'package.json');
  const packages = [], seen = new Set();
  const visit = (name, importer) => {
    assert.ok(name.startsWith('@sharpforge/'), 'Only declared workspace dependencies');
    const directory = resolve(root, 'packages', name.slice('@sharpforge/'.length));
    const entry = realpathSync(createRequire(importer).resolve(name));
    assert.equal(entry, resolve(directory, 'src/index.js'), 'Own public package alias: ' + name);
    if (seen.has(name)) return;
    seen.add(name);
    const manifestPath = resolve(directory, 'package.json'), manifestBytes = readFileSync(manifestPath);
    const manifest = JSON.parse(manifestBytes), files = sourceFiles(resolve(directory, 'src'));
    assert.equal(manifest.name, name);
    packages.push({ name, entry, manifestSha256: sha(manifestBytes), entrySha256: sha(readFileSync(entry)),
      sourceTree: git(root, 'rev-parse', `HEAD:packages/${name.slice('@sharpforge/'.length)}/src`),
      sourceSha256: sha(JSON.stringify(files)), files });
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) visit(dependency, entry);
  };
  visit('@sharpforge/cil', resolve(root, 'package.json'));
  const fixtures = {};
  for (const [name, pin] of Object.entries(fixturePins)) {
    fixtures[name] = sha(readFileSync(resolve(root, pin.path)));
    assert.equal(fixtures[name], pin.sha256, 'Unchanged common fixture: ' + pin.path);
  }
  return { root, side, head, productCommit: expected, tree: git(root, 'rev-parse', 'HEAD^{tree}'), packages, fixtures,
    sourceHashFormat: 'SHA256(JSON.stringify(sorted [{path,sha256}])) within each package src directory' };
}

export function benchmarkTools(root) {
  const hashes = Object.fromEntries(toolPaths.map(path => [path, sha(readFileSync(resolve(root, path)))]));
  git(root, 'ls-files', '--error-unmatch', '--', ...toolPaths);
  const path = 'packages/cil/tools/metadata-generations-benchmark-worker.mjs';
  const policy = JSON.parse(readFileSync(resolve(root, 'scripts/conformance/static/allowlist.json')));
  const entries = policy.allow.filter(value => value.path === path && value.operation === 'dynamic-import');
  assert.equal(entries.length, 1, 'Exactly one source-bound worker import allowance');
  assert.equal(entries[0].count, 2, 'Only the fixed public CIL entry and existing structural fixture helper');
  assert.equal(entries[0].sha256, hashes[path], 'Reviewed worker source bytes');
  return hashes;
}
