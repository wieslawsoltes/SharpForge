import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { GitHubProject } from './lib/github-project.js';
import { auditRecord } from './lib/claims.js';

export function reconstructAudit(comments, fieldHistory = []) {
  const events = comments.map(comment => ({ ...auditRecord(comment), commentId: comment.id })).filter(e => e.version === 1);
  const timeline = [...events, ...fieldHistory.map(e => ({ ...e, source: 'project-field-history' }))].sort((a, b) => a.at.localeCompare(b.at) || (a.sequence ?? 0) - (b.sequence ?? 0) || (a.commentId ?? 0) - (b.commentId ?? 0));
  const gaps = events.length ? [] : ['No structured claim events available']; let owner = null, generation = null; const held = new Set();
  for (const event of events.sort((a, b) => a.at.localeCompare(b.at) || a.sequence - b.sequence)) {
    if (event.event === 'claim') {
      if (owner) gaps.push(`claim by ${event.agent} before ${owner} released`);
      owner = event.agent; generation = event.generation;
    } else if (event.generation !== generation || !owner) gaps.push(`${event.event} has no matching claim generation`);
    if (event.event === 'lock') held.add(event.key);
    if (event.event === 'unlock') held.delete(event.key);
    if (event.event === 'release') { owner = null; generation = null; held.clear(); }
  }
  return { timeline, owner, locks: [...held].sort(), gaps, complete: gaps.length === 0, limitations: ['GitHub Projects does not expose a general field-value history API; supplied fieldHistory is merged explicitly. Legacy unstructured comments are not proof of a complete timeline.'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { issue: { type: 'string' }, owner: { type: 'string', default: 'wieslawsoltes' }, repo: { type: 'string', default: 'SharpForge' } } });
  if (!/^\d+$/.test(values.issue ?? '')) throw new Error('--issue required');
  const client = new GitHubProject(values);
  console.log(JSON.stringify(reconstructAudit(await client.comments(values.issue)), null, 2));
}
