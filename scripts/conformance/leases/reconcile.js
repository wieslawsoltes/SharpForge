import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { GitHubProject } from '../../planning/lib/github-project.js';
import { ghTransport } from '../../planning/lib/gh-retry.js';
import { Claims } from '../../planning/lib/claims.js';
import { snapshotBacklog } from '../../planning/snapshot-backlog.js';
import { syncReady } from '../../planning/sync-ready.js';
import { isMain } from '../../planning/lib/io.js';

/** Permit labels and temporary claim mutexes only; never reassign ownership or post issue comments. */
export function boundedClient(client, { dryRun = false } = {}) {
  const bounded = Object.create(client);
  const mutex = name => {
    if (!/^agent-ops\/SF-(?:A\d{2}|R\d{3})-[TB]\d{2}(?:\.\d+)?$/.test(name)) throw new Error('Only operation mutex refs are writable');
  };
  bounded.comment = async () => undefined;
  bounded.setFields = async () => { throw new Error('Scheduled reconciliation cannot change Project fields'); };
  bounded.writeRecord = async () => { throw new Error('Scheduled reconciliation cannot replace claims'); };
  bounded.updateRef = async () => { throw new Error('Scheduled reconciliation cannot update refs'); };
  bounded.createRef = async (name, sha) => { mutex(name); if (!dryRun) return client.createRef(name, sha); };
  bounded.deleteRef = async name => { mutex(name); if (!dryRun) return client.deleteRef(name); };
  bounded.label = async (issue, label) => {
    if (!['lease:expired', 'status:ready'].includes(label)) throw new Error('Unapproved scheduled label');
    if (!dryRun) return client.label(issue, label);
  };
  bounded.removeLabel = async (issue, label) => {
    if (label !== 'status:ready') throw new Error('Unapproved scheduled label removal');
    if (!dryRun) return client.removeLabel(issue, label);
  };
  return bounded;
}

export async function reconcile({ client, snapshot, dryRun = false, now = () => new Date() }) {
  const bounded = boundedClient(client, { dryRun });
  const expired = await new Claims(bounded, { now }).reap();
  const errors = expired.filter(item => item.error).map(item => item.error);
  let readiness = null;
  try { readiness = await syncReady(bounded, typeof snapshot === 'function' ? await snapshot() : snapshot, { dryRun }); }
  catch (error) { errors.push(error.message); }
  return { schemaVersion: 1, dryRun, expired, readiness, errors, passed: errors.length === 0 };
}

export function scheduledClient(environment = process.env) {
  if (!environment.GH_TOKEN || !environment.PROJECT_READ_TOKEN) {
    throw new Error('GH_TOKEN and read-only PROJECT_READ_TOKEN must be explicitly configured');
  }
  if (!['schedule', 'workflow_dispatch'].includes(environment.GITHUB_EVENT_NAME) ||
      environment.GITHUB_REF !== `refs/heads/${environment.DEFAULT_BRANCH}`) {
    throw new Error('Lease reconciliation requires a scheduled/manual default-branch run');
  }
  const transport = token => ghTransport({ spawnProcess: (command, args, options) => spawn(command, args, {
    ...options, env: { ...environment, GH_TOKEN: token, PROJECT_READ_TOKEN: '' },
  }) });
  const project = transport(environment.PROJECT_READ_TOKEN), repository = transport(environment.GH_TOKEN);
  const [owner, repo] = environment.GITHUB_REPOSITORY.split('/');
  return new GitHubProject({ owner, repo, transport: request => {
    if (request.path === 'graphql') {
      if (!/^query\b/.test(request.body?.query?.trim() ?? '')) throw new Error('Projects credential is read-only');
      return project(request);
    }
    return repository(request);
  } });
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: {
    snapshot: { type: 'string' },
    output: { type: 'string', default: 'artifacts/lease-reconciliation.json' },
    'dry-run': { type: 'boolean' },
  } });
  try {
    const client = scheduledClient();
    const snapshot = values.snapshot ? JSON.parse(readFileSync(values.snapshot, 'utf8')) : async () => {
      const value = await snapshotBacklog(client);
      mkdirSync(dirname(values.output), { recursive: true });
      writeFileSync(values.output + '.snapshot.json', JSON.stringify(value, null, 2) + '\n');
      return value;
    };
    const result = await reconcile({ client, snapshot, dryRun: Boolean(values['dry-run']) });
    mkdirSync(dirname(values.output), { recursive: true });
    writeFileSync(values.output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
