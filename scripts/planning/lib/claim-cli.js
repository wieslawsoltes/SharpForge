import { parseArgs } from 'node:util';
import { GitHubProject } from './github-project.js';
import { Claims } from './claims.js';
import { requireReady, contractsOnMain } from '../ready.js';
import { readJSON } from './io.js';
export async function main(command, argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    owner: { type: 'string', default: 'wieslawsoltes' }, repo: { type: 'string', default: 'SharpForge' }, project: { type: 'string', default: '4' },
    issue: { type: 'string' }, agent: { type: 'string' }, branch: { type: 'string' }, 'ttl-hours': { type: 'string', default: '24' },
    snapshot: { type: 'string', default: 'planning/backlog.snapshot.json' }, contracts: { type: 'string' }, key: { type: 'string' }, release: { type: 'boolean' }, reconcile: { type: 'boolean' }, reason: { type: 'string' }, handoff: { type: 'string' }, help: { type: 'boolean' }
  } });
  if (values.help) { console.log(`node scripts/planning/${command}.js --issue NUMBER --agent codex-session [--branch agent-implementation/SF-A00-T07.3] [--ttl-hours 24] [--key studio] [--release] [--reconcile --reason TEXT] [--handoff URL]\n--owner LOGIN --repo REPO --project NUMBER; reap-leases takes only project options. No mutation occurs for --help.`); return; }
  if (command !== 'reap-leases' && (!/^\d+$/.test(values.issue ?? '') || !values.agent)) throw new Error('--issue and --agent are required');
  const client = new GitHubProject({ owner: values.owner, repo: values.repo, number: values.project });
  const claims = new Claims(client), options = { ...values, issue: Number(values.issue), ttlHours: Number(values['ttl-hours']) };
  if (command === 'claim') options.ready = item => requireReady(readJSON(values.snapshot), item.content.title.match(/^\[([^\]]+)\]/)?.[1], { contracts: values.contracts ? contractsOnMain(readJSON(values.contracts)) : {} });
  const result = command === 'reap-leases' ? await claims.reap() : await claims[command](options);
  console.log(JSON.stringify(result, null, 2));
}
