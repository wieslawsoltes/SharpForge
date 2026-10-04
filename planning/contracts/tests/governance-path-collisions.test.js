import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { primaryPaths, pathCollisions } from '../../../scripts/planning/check-path-collisions.js';

const snapshot = JSON.parse(readFileSync(new URL('../../backlog.snapshot.json', import.meta.url), 'utf8'));
const leaf = (id, body, extra = {}) => ({ id, body, state: 'OPEN', kind: 'Task', parent: null, ...extra });
function captured(number) {
  const issue = snapshot.issues.find(row => row.number === number);
  assert.ok(issue, `Missing captured issue #${number}`);
  // Exercise the captured declaration with isolated open-leaf fixture state.
  return leaf(issue.id, issue.body, { number });
}

test('actual Owns declarations exclude workstream scope and shared-hot-file cautions', () => {
  const cases = [
    [441, 'scripts/planning/check-path-collisions.js'],
    [431, 'packages/compiler/src/dispatch.js'],
    [432, 'packages/compiler/src/diagnostics.js'],
  ];
  const issues = cases.map(([number, path]) => {
    const issue = captured(number);
    assert.ok(issue.body.includes('Workstream write scope:'));
    assert.ok(issue.body.includes('Shared hot files'));
    assert.deepEqual(primaryPaths(issue), [path], `#${number}`);
    return issue;
  });
  assert.deepEqual(pathCollisions(issues), { errors: [], serialized: [] });
});

test('actual area and release Write only declarations expose their overlapping publish paths', () => {
  const broad = ['packages/publish/**', 'apps/cli/publish.js', 'apps/studio/publish-*.js'];
  const first = captured(364), second = captured(365), release = captured(425);
  assert.deepEqual(primaryPaths(first), broad);
  assert.deepEqual(primaryPaths(second), broad);
  assert.deepEqual(primaryPaths(release), ['packages/publish/src/profiles/**', 'tests/r015-publish-profiles*']);
  const shared = pathCollisions([first, second]);
  assert.equal(shared.errors.length, 3);
  for (const path of broad) assert.ok(shared.errors.some(message => message.includes(`(${path}) overlaps`)));
  const scoped = pathCollisions([first, release]);
  assert.deepEqual(scoped.serialized, []);
  assert.deepEqual(scoped.errors, ['SF-A26-T07 (packages/publish/**) overlaps SF-R015-T03 (packages/publish/src/profiles/**)']);
});

test('plain and bold ownership labels retain contiguous code paths and periods inside paths', () => {
  for (const label of ['Owns:', '**Owns:**', 'Write only:', '**Write only:**']) {
    const body = `${label} \`src/first.test.js\`, \`src/second.cs\`\t\`docs/api.v1.md\`. Workstream write scope: \`src/**\`. Shared hot files: \`studio.js\``;
    assert.deepEqual(primaryPaths({ body }), ['src/first.test.js', 'src/second.cs', 'docs/api.v1.md'], label);
  }
  assert.deepEqual(primaryPaths({ body: '**Write only:** `planning/contracts/**`, `scripts/planning/**`' }),
    ['planning/contracts/**', 'scripts/planning/**']);
  assert.deepEqual(primaryPaths({ body: 'Owns: `src/a.js`\r\nWrite only: `src/b.js`' }), ['src/a.js', 'src/b.js']);
});

test('primary lists stop at prose or a newline and do not infer paths from other fields', () => {
  for (const body of [
    '**Owns:** `src/a.js`. Workstream write scope: `src/**`.',
    '**Owns:** `src/a.js` Shared hot files: `src/shared.js`',
    '**Owns:** `src/a.js`,\n  `src/continued.js`',
    '**Owns:** `src/a.js`\nRead-only evidence: `src/evidence.js`',
  ]) assert.deepEqual(primaryPaths({ body }), ['src/a.js'], body);
  for (const body of [
    'Workstream write scope: `src/**`',
    'Shared hot files: `src/shared.js`',
    'An example Owns: `src/example.js`',
    'An example **Write only:** `src/example.js`',
    '**Owns:** see the owner of `src/other.js`',
  ]) assert.deepEqual(primaryPaths({ body }), [], body);
  assert.deepEqual(primaryPaths({}), []);
});

test('mixed declaration styles collide on primary paths but not on explanatory broad scopes', () => {
  const a = leaf('SF-A00-T01', '**Owns:** `src/a.js`. Workstream write scope: `src/**`. Shared hot files: `studio.js`');
  const b = leaf('SF-A00-T02', 'Write only: `src/a.js`');
  assert.equal(pathCollisions([a, b]).errors.length, 1);
  b.body = '**Write only:** `src/b.js`';
  assert.deepEqual(pathCollisions([a, b]), { errors: [], serialized: [] });
  b.body = '**Write only:** `src/**`';
  assert.equal(pathCollisions([a, b]).errors.length, 1);
});

test('explicit paths overrides remain authoritative including an empty override', () => {
  const a = leaf('SF-A00-T01', '**Owns:** `src/shared.js`', { paths: ['src/a.js'] });
  const b = leaf('SF-A00-T02', 'Write only: `src/shared.js`', { paths: ['src/b.js'] });
  assert.equal(pathCollisions([a, b]).errors.length, 0);
  b.paths = ['src/a.js'];
  assert.equal(pathCollisions([a, b]).errors.length, 1);
  a.paths = [];
  assert.equal(pathCollisions([a, b]).errors.length, 0);
  a.paths = null; b.paths = null;
  assert.equal(pathCollisions([a, b]).errors.length, 1);
});

test('only a common declared lock covering both primary paths serializes a collision', () => {
  const a = leaf('SF-A00-T01', '**Owns:** `src/a.js`', { lockKeys: ['fixture-lock'] });
  const b = leaf('SF-A00-T02', 'Write only: `src/**`', { project: { 'Lock keys': 'unrelated; fixture-lock' } });
  const result = pathCollisions([a, b], { 'fixture-lock': ['src/**'] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.serialized, [{ tasks: [a.id, b.id], locks: ['fixture-lock'], paths: ['src/a.js', 'src/**'] }]);
  assert.equal(pathCollisions([a, b], { 'fixture-lock': ['docs/**'] }).errors.length, 1);
  assert.equal(pathCollisions([a, b]).errors.length, 1);
  b.project['Lock keys'] = 'unrelated';
  assert.equal(pathCollisions([a, b], { 'fixture-lock': ['src/**'] }).errors.length, 1);
});

test('closed issues, epics and parents remain excluded from open-leaf collisions', () => {
  const a = leaf('SF-A00-T01', '**Write only:** `src/shared.js`');
  const b = leaf('SF-A00-T02', 'Write only: `src/shared.js`');
  assert.equal(pathCollisions([a, b]).errors.length, 1);
  a.state = 'CLOSED';
  assert.equal(pathCollisions([a, b]).errors.length, 0);
  a.state = 'OPEN'; a.kind = 'Epic';
  assert.equal(pathCollisions([a, b]).errors.length, 0);
  a.kind = 'Task';
  const child = leaf('SF-A00-T01.1', '**Owns:** `src/child.js`', { parent: a.id });
  assert.deepEqual(pathCollisions([a, b, child]), { errors: [], serialized: [] });
});

test('the CLI fails on a real primary collision and passes distinct primary declarations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-primary-paths-'));
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const path = join(directory, 'snapshot.json');
  const a = leaf('SF-A00-T01', '**Owns:** `src/a.js`. Workstream write scope: `src/**`.');
  const b = leaf('SF-A00-T02', 'Write only: `src/a.js`');
  try {
    for (const collision of [true, false]) {
      b.body = `Write only: \`src/${collision ? 'a' : 'b'}.js\``;
      writeFileSync(path, JSON.stringify({ issues: [a, b] }));
      const result = spawnSync(process.execPath, [join(root, 'scripts/planning/check-path-collisions.js'), '--snapshot', path], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, collision ? 1 : 0, result.stderr || result.stdout);
      assert.equal(JSON.parse(result.stdout).errors.length, collision ? 1 : 0);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
