import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTask } from '../../scripts/planning/lib/task-ref.js';
import { lintBacklog } from '../../scripts/planning/lint-backlog.js';
const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('filled PR template resolves a unique claimed task', () => {
  const body = read('.github/pull_request_template.md').replace('Task: SF-A00-T00', 'Task: SF-A29-T18');
  assert.equal(resolveTask({ branch: 'codex/templates', body, projectBranch: 'codex/templates' }), 'SF-A29-T18');
});
test('issue-form default field values render lintable task and bug bodies', () => {
  for (const [kind, id] of [['task', 'SF-A29-T18'], ['bug', 'SF-A29-B01']]) {
    const form = read(`.github/ISSUE_TEMPLATE/${kind}.yml`);
    // The form uses JSON-compatible quoted scalar defaults; GitHub joins submitted fields under their labels.
    const values = [...form.matchAll(/^      value: (".*")$/gm)].map(match => JSON.parse(match[1]));
    assert(values.length >= 3);
    assert.deepEqual(lintBacklog([{ number: 1, title: `[${id}] Fixture`, body: values.join('\n\n') }]).errors, []);
  }
});
