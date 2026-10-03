import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { git } from '../scripts/planning/lib/io.js';

const cli = fileURLToPath(new URL('../scripts/planning/review-gates.js', import.meta.url));
const idsPath = 'planning/contracts/framework-ids.lock.json';
const versionsPath = 'planning/contracts/versions.json';
const goldenPath = 'planning/contracts/golden-output.lock.json';
const schemaPath = 'planning/contracts/schema/value.schema.json';
const versions = { framework: 1, bytecode: 1, value: 1, metadata: 1 };
const ids = [{ id: 1, name: 'First' }];
const golden = { schemaVersion: 1, examples: [], bundles: [] };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sf-review-gates-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'repo');
  mkdirSync(root);
  const command = args => git(args, root).trim();
  const write = (path, value) => {
    const full = join(root, path);
    if (value === null) return rmSync(full);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value) + '\n');
  };
  const commit = changes => {
    for (const [path, value] of Object.entries(changes)) write(path, value);
    command(['add', '.']);
    command(['commit', '-m', 'fixture']);
    return command(['rev-parse', 'HEAD']);
  };
  command(['init', '-b', 'main']);
  command(['config', 'user.name', 'Fixture']);
  command(['config', 'user.email', 'fixture@example.test']);
  command(['config', 'commit.gpgsign', 'false']);
  const base = commit({
    [idsPath]: ids, [versionsPath]: versions, [goldenPath]: golden,
    [schemaPath]: { type: 'string' },
    'scripts/build.js': "throw new Error('Review must not rebuild golden outputs');\n",
  });
  const run = (options = {}) => {
    const checkout = command(['rev-parse', 'HEAD']);
    const event = options.event ?? {
      action: options.action ?? 'synchronize', number: 1,
      pull_request: { base: { sha: options.base ?? base }, head: { sha: options.head ?? checkout },
        labels: (options.labels ?? []).map(name => ({ name })) },
    };
    const eventPath = join(directory, 'event.json');
    writeFileSync(eventPath, JSON.stringify(event));
    const child = spawnSync(process.execPath, [cli], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: options.eventName ?? 'pull_request',
        GITHUB_SHA: options.expectedSha ?? checkout, PR_LABELS: 'contract-change,seam' },
    });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.stderr, '', child.stderr);
    return { status: child.status, ...JSON.parse(child.stdout) };
  };
  return { root, base, command, write, commit, run };
}

test('core runs the lightweight review on PRs and reruns when labels are removed', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const core = workflow.split('  core-platforms:')[0];
  assert.match(core, /types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
  assert.match(core, /if: github.event_name == 'pull_request'\n        run: node scripts\/planning\/review-gates.js/);
  assert.ok(core.indexOf('run: node scripts/planning/review-gates.js') < core.indexOf('run: npm ci'));
  assert.doesNotMatch(core, /pull_request_target|golden-output.js|(?:contents|issues|pull-requests): write/);
});

test('committed additive IDs and unchanged seam locks pass without a build or label declaration', t => {
  const repository = fixture(t);
  repository.commit({ [idsPath]: [...ids, { id: 2, name: 'Second' }] });
  const result = repository.run({ labels: ['seam'] });
  assert.equal(result.status, 0);
  assert.equal(result.passed, true);
  assert.deepEqual(result.changes, [{ path: idsPath, component: 'framework', breaking: false }]);
  assert.deepEqual(result.errors, []);
});

test('actual removal requires both the event label and a strictly larger relevant version', async t => {
  const cases = [
    { name: 'neither', labels: [], after: versions, errors: /contract-change label.*framework version bump/s },
    { name: 'label only', labels: ['contract-change'], after: versions, errors: /framework version bump/ },
    { name: 'bump only', labels: [], after: { ...versions, framework: 2 }, errors: /contract-change label/ },
    { name: 'wrong component', labels: ['contract-change'], after: { ...versions, metadata: 2 }, errors: /framework version bump/ },
    { name: 'both', labels: ['contract-change'], after: { ...versions, framework: 2 } },
  ];
  for (const entry of cases) await t.test(entry.name, child => {
    const repository = fixture(child);
    repository.commit({ [idsPath]: [], [versionsPath]: entry.after });
    const result = repository.run({ labels: entry.labels });
    assert.equal(result.status, entry.errors ? 1 : 0);
    if (entry.errors) assert.match(result.errors.join('\n'), entry.errors);
    else assert.deepEqual(result.errors, []);
  });
});

test('removing the contract-change label reruns the same SHA and rejects its breaking diff', t => {
  const repository = fixture(t);
  repository.commit({ [idsPath]: null, [versionsPath]: { ...versions, framework: 2 } });
  const accepted = repository.run({ labels: ['contract-change'], action: 'labeled' });
  const rejected = repository.run({ labels: [], action: 'unlabeled' });
  assert.equal(accepted.status, 0);
  assert.equal(rejected.status, 1);
  assert.equal(accepted.head, rejected.head);
  assert.match(rejected.errors.join('\n'), /non-additive change requires contract-change label/);
});

test('schema tightening uses its component version and duplicate IDs still fail with declarations', async t => {
  await t.test('schema', child => {
    const repository = fixture(child);
    repository.commit({ [schemaPath]: { type: 'string', maxLength: 2 } });
    assert.match(repository.run().errors.join('\n'), /value version bump/);
    repository.commit({ [versionsPath]: { ...versions, value: 2 } });
    assert.equal(repository.run({ labels: ['contract-change'] }).status, 0);
  });
  await t.test('duplicate', child => {
    const repository = fixture(child);
    repository.commit({ [idsPath]: [...ids, ...ids], [versionsPath]: { ...versions, framework: 2 } });
    const result = repository.run({ labels: ['contract-change'] });
    assert.equal(result.status, 1);
    assert.match(result.errors.join('\n'), /duplicate contract id/);
  });
});

test('a seam golden change fails even with contract-change and version bump; reviewed non-seam passes', t => {
  const repository = fixture(t);
  repository.commit({ [goldenPath]: { ...golden, schemaVersion: 2 }, [versionsPath]: { ...versions, metadata: 2 } });
  const rejected = repository.run({ labels: ['seam', 'contract-change'] });
  assert.equal(rejected.status, 1);
  assert.match(rejected.errors.join('\n'), /seam-labelled PR must preserve/);
  assert.equal(repository.run({ labels: ['contract-change'] }).status, 0);
});

test('seam comparison preserves exact bytes including formatting and fails for a deleted lock', async t => {
  for (const [name, value] of [['formatting', JSON.stringify(golden, null, 2) + '\n'], ['deletion', null]]) {
    await t.test(name, child => {
      const repository = fixture(child);
      repository.commit({ [goldenPath]: value, [versionsPath]: { ...versions, metadata: 2 } });
      const result = repository.run({ labels: ['seam', 'contract-change'] });
      assert.equal(result.status, 1);
      assert.equal(result.passed, false);
      assert.ok(result.errors.length);
    });
  }
});

test('review reads pinned commits even when worktree locks are edited after checkout', t => {
  const repository = fixture(t);
  repository.write(idsPath, []);
  repository.write(goldenPath, { changed: true });
  const result = repository.run({ labels: ['seam'] });
  assert.equal(result.status, 0);
  assert.deepEqual(result.changes, []);
});

test('real merge checkout verifies the exact head and excludes unrelated additions on the base branch', t => {
  const repository = fixture(t);
  const head = repository.commit({ 'feature.txt': 'feature\n' });
  repository.command(['checkout', '-b', 'base-update', repository.base]);
  const base = repository.commit({ 'planning/contracts/base-only.lock.json': [{ id: 40 }] });
  repository.command(['merge', '--no-ff', '--no-edit', head]);
  const result = repository.run({ base, head, labels: ['seam'] });
  assert.equal(result.status, 0);
  assert.equal(result.mergeBase, repository.base);
  assert.deepEqual(result.changes, []);
  assert.notEqual(result.checkout, head);
  assert.match(repository.run({ base, head: repository.base }).errors.join('\n'), /base\/head do not match/);
  // A refreshed GitHub merge can legitimately have a newer first parent than its event snapshot.
  const advanced = repository.run({ base: repository.base, head, labels: ['seam'] });
  assert.equal(advanced.status, 0);
  assert.equal(advanced.eventBase, repository.base);
  assert.equal(advanced.base, base);
});

test('advanced merge base excludes contract changes that have already landed on the target branch', t => {
  const repository = fixture(t);
  const shared = repository.commit({ [idsPath]: [] });
  const head = repository.commit({ 'feature.txt': 'feature\n' });
  repository.command(['checkout', '-b', 'base-update', shared]);
  const base = repository.commit({ 'main.txt': 'main advanced\n' });
  repository.command(['merge', '--no-ff', '--no-edit', head]);
  const result = repository.run({ base: repository.base, head, labels: ['seam'] });
  assert.equal(result.status, 0);
  assert.equal(result.eventBase, repository.base);
  assert.equal(result.base, base);
  assert.equal(result.mergeBase, shared);
  assert.deepEqual(result.changes, []);
});

test('a merge checkout with a rewound or divergent base cannot borrow the PR event labels', async t => {
  for (const kind of ['rewound', 'divergent']) await t.test(kind, child => {
    const repository = fixture(child);
    const head = repository.commit({ 'feature.txt': 'feature\n' });
    repository.command(['checkout', '-b', 'merge-base', repository.base]);
    const base = repository.commit({ 'main.txt': 'target at merge\n' });
    repository.command(['merge', '--no-ff', '--no-edit', head]);
    const checkout = repository.command(['rev-parse', 'HEAD']);
    repository.command(['checkout', '--detach', kind === 'rewound' ? base : repository.base]);
    const eventBase = repository.commit({ 'event.txt': 'different event base\n' });
    repository.command(['checkout', '--detach', checkout]);
    const result = repository.run({ base: eventBase, head, labels: ['contract-change', 'seam'] });
    assert.equal(result.status, 1);
    assert.equal(result.passed, false);
    assert.match(result.errors.join('\n'), /does not descend from event base/);
  });
});

test('missing labels, mutable refs, stale workflow SHAs and non-PR event snapshots fail closed', async t => {
  for (const name of ['missing labels', 'invalid labels', 'mutable base', 'missing head', 'stale SHA', 'wrong event']) {
    await t.test(name, child => {
      const repository = fixture(child);
      const event = { pull_request: { base: { sha: repository.base }, head: { sha: repository.base }, labels: [] } };
      const options = { event };
      if (name === 'missing labels') delete event.pull_request.labels;
      if (name === 'invalid labels') event.pull_request.labels = ['contract-change'];
      if (name === 'mutable base') event.pull_request.base.sha = 'main';
      if (name === 'missing head') delete event.pull_request.head;
      if (name === 'stale SHA') options.expectedSha = '0'.repeat(40);
      if (name === 'wrong event') options.eventName = 'merge_group';
      const result = repository.run(options);
      assert.equal(result.status, 1);
      assert.equal(result.passed, false);
      assert.ok(result.errors.length);
    });
  }
});

test('malformed committed JSON and version removal fail rather than skipping review', async t => {
  for (const [name, changes] of [['malformed', { [idsPath]: '{broken' }], ['version removal', { [versionsPath]: {} }]]) {
    await t.test(name, child => {
      const repository = fixture(child);
      repository.commit(changes);
      const result = repository.run({ labels: ['contract-change'] });
      assert.equal(result.status, 1);
      assert.equal(result.passed, false);
      assert.ok(result.errors.length);
    });
  }
});
