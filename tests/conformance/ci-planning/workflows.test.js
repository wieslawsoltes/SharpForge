import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');

test('ordinary core retains shared checks/build and chooses impacted tests or one full fallback', () => {
  const core = read('ci').split('  core-platforms:')[0];
  assert.match(core, /run: npm run check/);
  assert.match(core, /run: npm run build/);
  assert.match(core, /run: npm test\n        if: steps.impact.outputs.mode != 'impacted'/);
  assert.match(core, /if: steps.impact.outputs.mode == 'impacted'/);
  assert.match(core, /detect.js --check-quarantine/);
  assert.doesNotMatch(core, /strategy:/);
});
test('planning and Rust PR jobs are opt-in, queues consume the actual generated full matrix', () => {
  for (const name of ['planning-gates', 'rust']) {
    const text = read(name);
    assert.match(text, /merge_group:/);
    assert.match(text, /if: github.event_name != 'pull_request' \|\| contains\(github.event.pull_request.labels.\*.name, 'full-ci'\)/);
    assert.doesNotMatch(text, /pull_request_target/);
  }
  assert.match(read('merge-queue'), /fromJSON\(needs.matrix.outputs.matrix\)/);
  assert.match(read('merge-queue'), /run-tests.js --area "\$AREA"/);
});
test('only scheduled default-branch lease job has issue/mutex write permissions', () => {
  const text = read('lease-reaper');
  assert.doesNotMatch(text, /pull_request/);
  assert.match(text, /default_branch/);
  assert.match(text, /PROJECT_READ_TOKEN:/);
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /issues: write/);
  assert.match(read('ci-stats'), /actions: read/);
  assert.match(read('ci-stats'), /schedule:/);
});
