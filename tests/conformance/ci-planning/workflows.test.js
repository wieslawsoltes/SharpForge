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
test('specialized qualification is dispatched explicitly without full-ci or queue fanout', () => {
  const names = ['browser-matrix', 'coverage', 'differential', 'gc-trace', 'inventory', 'merge-queue',
    'native', 'oracles', 'perf', 'planning-gates', 'rust', 'security'];
  for (const name of names) {
    const text = read(name), triggers = text.slice(text.indexOf('on:\n'), text.indexOf('permissions:'));
    assert.match(triggers, /workflow_dispatch:/, name);
    assert.doesNotMatch(triggers, /^  (?:push|pull_request|schedule|merge_group):/m, name);
    assert.doesNotMatch(text, /pull_request_target|full-ci/, name);
  }
  assert.match(read('merge-queue'), /fromJSON\(needs.matrix.outputs.matrix\)/);
  assert.match(read('merge-queue'), /run-tests.js --area "\$AREA"/);
  const repro = read('repro');
  assert.doesNotMatch(repro, /^  (?:push|pull_request|schedule):/m);
  assert.match(repro, /release:\n    types: \[published\]/);
  assert.match(repro, /!startsWith\(github.event.release.tag_name, 'evidence-archive-'\)/);
});
test('each qualification matrix and independent job family runs serially', () => {
  const chains = {
    ci: {'core-platforms': 'core', build: 'core-platforms', packages: 'build', browser: 'packages',
      'native-il': 'browser', 'native-msbuild': 'native-il', 'clr-wasm': 'native-msbuild'},
    differential: {desktop: 'linux'}, oracles: {desktop: 'linux'},
    inventory: {desktop: 'linux', browser: 'desktop'}, native: {node: 'sdk'},
    perf: {browser: 'paired'}, security: {codeql: 'supply'},
    repro: {offline: '[prepare, build, cross-runner]'},
  };
  for (const [name, chain] of Object.entries(chains)) {
    const text = read(name);
    for (const [job, previous] of Object.entries(chain)) {
      assert.ok(text.includes(`  ${job}:\n    needs: ${previous}\n`), `${name}/${job}`);
    }
  }
  for (const name of [...Object.keys(chains), 'browser-matrix', 'merge-queue', 'gc-trace']) {
    const text = read(name);
    assert.equal((text.match(/    strategy:\n/g) || []).length,
      (text.match(/    strategy:\n      max-parallel: 1\n/g) || []).length, name);
    assert.doesNotMatch(text, /node --test (?!--test-concurrency=1)/, name);
  }
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
