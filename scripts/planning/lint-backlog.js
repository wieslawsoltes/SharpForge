import { parseArgs } from 'node:util';
import { readJSON, isMain, report } from './lib/io.js';
import { WORK_ID } from './lib/deps-parse.js';
import { primaryPaths } from './check-path-collisions.js';

function headerField(body, name) {
  const header = body.split(/^##[ \t]/m, 1)[0];
  const value = header.match(new RegExp(`(?:^|[.·][ \\t]+)[ \\t]*(?:\\*\\*)?${name}:(?:\\*\\*)?[ \\t]*([^\\r\\n]*)`, 'm'))?.[1];
  return value?.split(/[ \t]+·[ \t]+|\.[ \t]+(?=(?:\*\*)?[A-Z][\w ]*:)/, 1)[0] ?? '';
}

export function lintBacklog(issues) {
  const errors = [], seen = new Map();
  for (const issue of issues) {
    const id = issue.id ?? issue.title?.match(/^\[([^\]]+)\]/)?.[1], body = issue.body ?? '', fail = text => errors.push(`#${issue.number}: ${text}`);
    if (!WORK_ID.test(id ?? '')) { fail('missing or malformed work ID'); continue; }
    if (seen.has(id)) fail(`duplicate ${id}, also #${seen.get(id)}`); else seen.set(id, issue.number);
    const area = /^(?:\*\*)?A\d{2}(?:\*\*)?(?=[ \t.·]|$)/;
    if (![headerField(body, 'Area'), headerField(body, 'Workstream')].some(value => area.test(value)) && !/Workstream write scope:/.test(body)) fail('missing area/workstream');
    if (!/-E\d/.test(id) && !/^## Deliverable\s*$/m.test(body)) fail('missing Deliverable section');
    if (!/-E\d/.test(id) && !/^## Acceptance criteria\s*$/m.test(body)) fail('missing Acceptance criteria');
    if (!primaryPaths(issue).length) fail('missing owned path');
    const parent = headerField(body, 'Parent');
    if (!/^(?:\*\*)?(?:\[[^\]\r\n]+\]\()?(?:https:\/\/github\.com\/[^/\s()]+\/[^/\s()]+\/issues\/|#)[1-9]\d*(?:\*\*)?(?=[ \t).·]|$)/.test(parent)) fail('missing parent issue link');
  }
  return { count: issues.length, errors };
}
if (isMain(import.meta.url)) { const { values } = parseArgs({ options: { snapshot: { type: 'string', default: 'planning/backlog.snapshot.json' } } }); report(lintBacklog(readJSON(values.snapshot).issues)); }
