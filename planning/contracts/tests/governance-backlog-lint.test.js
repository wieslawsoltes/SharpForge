import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lintBacklog } from '../../../scripts/planning/lint-backlog.js';

const snapshot = JSON.parse(readFileSync(new URL('../../backlog.snapshot.json', import.meta.url), 'utf8'));
const sections = '## Deliverable\nCode\n\n## Acceptance criteria\n- [ ] Works\n\n## Ownership\n**Owns:** `scripts/planning/fixture.js`';
const task = (header = 'Area: A00\nParent: #1', extra = {}) => ({
  number: 701, id: 'SF-A00-T99', body: `${header}\n\n${sections}`, ...extra,
});
const missing = (issue, field) => assert.deepEqual(lintBacklog([issue]).errors, [`#${issue.number}: missing ${field}`]);

test('captured release, legacy and portfolio-parent bodies satisfy the template', () => {
  const numbers = [423, 424, 425, 426, 440, 364, 3];
  const issues = numbers.map(number => {
    const issue = snapshot.issues.find(row => row.number === number);
    assert.ok(issue, `Missing captured issue #${number}`);
    return issue;
  });
  assert.ok(issues[0].body.includes('Release: [0.15 delivery]'));
  assert.ok(issues[6].body.includes('[SF-PORTFOLIO](https://github.com/wieslawsoltes/SharpForge/issues/1)'));
  assert.deepEqual(lintBacklog(issues), { count: numbers.length, errors: [] });
});

test('metadata supports actual plain, bold, numeric and linked header declarations', () => {
  for (const header of [
    '**Area:** A00 — Contracts\n**Parent:** #1 (SF-A00-E01)',
    'Area: **A00**. Parent: [SF-A00-E01](https://github.com/owner/repo/issues/1).',
    '**Parent:** #1 · **Workstream:** A00 — Contracts · **Priority:** P1',
    'Workstream: **A00**\nParent: https://github.com/owner/repo/issues/1',
    '**Area:** **A00**\r\n**Parent:** **#1**',
    'Release: [delivery](https://github.com/owner/repo/issues/422). Area: A00. Parent: #1.',
  ]) assert.deepEqual(lintBacklog([task(header)]).errors, [], header);
});

test('area requires a declared complete area token, including for release IDs', () => {
  for (const area of ['', 'Area:', 'Area: A0', 'Area: A000', 'Area: A00extra',
    'Area: R015', 'Area: see A00', 'An example Area: A00', 'Workstream: prose']) {
    missing(task(`${area}\nParent: #1`, { id: 'SF-R015-T99', area: 'A00' }), 'area/workstream');
  }
  const late = task('Parent: #1');
  late.body += '\nArea: A00\nWorkstream: A00';
  missing(late, 'area/workstream');
});

test('the explicit legacy workstream write scope remains a valid area declaration', () => {
  const issue = task('Parent: #1');
  issue.body += '. Workstream write scope: `planning/contracts/**`, `scripts/planning/**`.';
  assert.deepEqual(lintBacklog([issue]).errors, []);
});

test('Parent must contain its own issue token within the metadata field', () => {
  for (const parent of [
    '', 'Parent:', 'Parent: SF-A00-E01', 'Parent: see #1',
    'An example Parent: #1', 'Parent: [SF-A00-E01](https://example.com/issues/1)',
    'Parent: . Release: [delivery](https://github.com/owner/repo/issues/422).',
    'Parent: · Related: #1', 'Parent: unresolved. Related: #1',
    'Release: [delivery](https://github.com/owner/repo/issues/422).',
  ]) missing(task(`Area: A00\n${parent}`), 'parent issue link');
  const late = task('Area: A00');
  late.body += '\nParent: #1';
  missing(late, 'parent issue link');
});

test('owned paths require a body declaration and share the primary-path grammar', () => {
  for (const label of ['Owns:', '**Owns:**', 'Write only:', '**Write only:**']) {
    const issue = task();
    issue.body = issue.body.replace('**Owns:**', label);
    assert.deepEqual(lintBacklog([issue]).errors, [], label);
  }
  for (const ownership of [
    '', 'Read-only evidence: `scripts/planning/fixture.js`',
    'An example Owns: `scripts/planning/fixture.js`',
    '**Owns:** see `scripts/planning/fixture.js`',
    '**Write only:**\n`script.js`',
  ]) {
    const issue = task(undefined, { paths: ['scripts/planning/fixture.js'] });
    issue.body = issue.body.replace('**Owns:** `scripts/planning/fixture.js`', ownership);
    missing(issue, 'owned path');
  }
});

test('required sections and issue-number diagnostics remain enforced', () => {
  for (const [heading, error] of [['Deliverable', 'Deliverable section'], ['Acceptance criteria', 'Acceptance criteria']]) {
    const issue = task();
    issue.body = issue.body.replace(`## ${heading}`, `### ${heading}`);
    missing(issue, error);
  }
  assert.deepEqual(lintBacklog([task('', { body: '' })]), { count: 1, errors: [
    '#701: missing area/workstream', '#701: missing Deliverable section',
    '#701: missing Acceptance criteria', '#701: missing owned path', '#701: missing parent issue link',
  ] });
  const epic = task(undefined, { id: 'SF-A00-E99' });
  epic.body = epic.body.replace('## Deliverable', '## Child work').replace('## Acceptance criteria', '## Completion');
  assert.deepEqual(lintBacklog([epic]).errors, []);
});

test('work IDs and duplicate subtasks retain their existing validation', () => {
  const first = task(undefined, { id: 'SF-A00-T99.1' });
  const second = { ...first, number: 702 };
  assert.deepEqual(lintBacklog([first, second]), { count: 2, errors: ['#702: duplicate SF-A00-T99.1, also #701'] });
  for (const id of [undefined, '', 'SF-A0-T01', 'SF-R15-T01', 'SF-A00-T99.1.2']) {
    assert.deepEqual(lintBacklog([task(undefined, { id })]).errors, ['#701: missing or malformed work ID']);
  }
  const titled = task(undefined, { id: undefined, title: '[SF-R015-T99] Release fixture' });
  assert.deepEqual(lintBacklog([titled]).errors, []);
});

test('CLI succeeds for a captured release and reports each invalid issue number', () => {
  const release = snapshot.issues.find(issue => issue.number === 425);
  assert.ok(release);
  const directory = mkdtempSync(join(tmpdir(), 'sf-backlog-lint-'));
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const path = join(directory, 'snapshot.json');
  try {
    for (const invalid of [false, true]) {
      const issues = invalid ? [task('Area: A00'), task('Parent: #1', { id: 'SF-A00-T98', number: 702 })] : [release];
      writeFileSync(path, JSON.stringify({ issues }));
      const result = spawnSync(process.execPath, [join(root, 'scripts/planning/lint-backlog.js'), '--snapshot', path], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, invalid ? 1 : 0, result.stderr || result.stdout);
      assert.deepEqual(JSON.parse(result.stdout), invalid
        ? { count: 2, errors: ['#701: missing parent issue link', '#702: missing area/workstream'] }
        : { count: 1, errors: [] });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
