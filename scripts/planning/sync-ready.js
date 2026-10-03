import { parseArgs } from 'node:util';
import { GitHubProject } from './lib/github-project.js';
import { readiness, contractsOnMain } from './ready.js';
import { validateDag } from './validate-dag.js';
import { readJSON, isMain } from './lib/io.js';
export async function syncReady(client, snapshot, { contracts = {}, dryRun = false } = {}) {
  const invalid = validateDag(snapshot).errors;
  if (invalid.length) throw new Error(`Invalid backlog; labels unchanged: ${invalid.join('; ')}`);
  const changes = [];
  for (const issue of snapshot.issues) {
    const ready = readiness(snapshot, issue.id, contracts).ready;
    const labels = await client.pages(`issues/${issue.number}/labels`);
    const wasReady = labels.some(l => (typeof l === 'string' ? l : l.name) === 'status:ready');
    if (ready === wasReady) continue;
    changes.push({ issue: issue.number, task: issue.id, ready });
    if (!dryRun) { if (ready) await client.label(issue.number, 'status:ready'); else await client.removeLabel(issue.number, 'status:ready'); }
  }
  return { dryRun, changes };
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { snapshot: { type: 'string', default: 'planning/backlog.snapshot.json' }, contracts: { type: 'string' }, owner: { type: 'string', default: 'wieslawsoltes' }, repo: { type: 'string', default: 'SharpForge' }, 'dry-run': { type: 'boolean' } } });
  console.log(JSON.stringify(await syncReady(new GitHubProject(values), readJSON(values.snapshot), { contracts: values.contracts ? contractsOnMain(readJSON(values.contracts)) : {}, dryRun: !!values['dry-run'] }), null, 2));
}
