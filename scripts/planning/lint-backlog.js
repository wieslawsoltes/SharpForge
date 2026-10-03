import { parseArgs } from 'node:util';
import { readJSON, isMain, report } from './lib/io.js';
import { WORK_ID } from './lib/deps-parse.js';
export function lintBacklog(issues) {
  const errors = [], seen = new Map();
  for (const issue of issues) {
    const id = issue.id ?? issue.title?.match(/^\[([^\]]+)\]/)?.[1], body = issue.body ?? '', fail = text => errors.push(`#${issue.number}: ${text}`);
    if (!WORK_ID.test(id ?? '')) { fail('missing or malformed work ID'); continue; }
    if (seen.has(id)) fail(`duplicate ${id}, also #${seen.get(id)}`); else seen.set(id, issue.number);
    if (!/(?:\*\*(?:Area|Workstream):\*\*|Workstream write scope:)/.test(body)) fail('missing area/workstream');
    if (!/-E\d/.test(id) && !/^## Deliverable\s*$/m.test(body)) fail('missing Deliverable section');
    if (!/-E\d/.test(id) && !/^## Acceptance criteria\s*$/m.test(body)) fail('missing Acceptance criteria');
    if (!/(?:\*\*(?:Write only|Owns):\*\*|Write only:)\s*`/.test(body)) fail('missing owned path');
    if (!/\*\*Parent:\*\*[^\n]*(?:https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+|#\d+)/.test(body)) fail('missing parent issue link');
  }
  return { count: issues.length, errors };
}
if (isMain(import.meta.url)) { const { values } = parseArgs({ options: { snapshot: { type: 'string', default: 'planning/backlog.snapshot.json' } } }); report(lintBacklog(readJSON(values.snapshot).issues)); }
