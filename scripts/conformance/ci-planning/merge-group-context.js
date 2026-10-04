import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { GitHubProject } from '../../planning/lib/github-project.js';
import { isMain } from '../../planning/lib/io.js';
import { normalizePlanningContext } from './context.js';

const sha = /^[a-f0-9]{40}$/;
const limit = 100;
const branchRef = value => typeof value === 'string' && /^refs\/heads\/[^\s~^:?*[\\]+$/.test(value)
  && !value.includes('..') && !value.includes('@{') && !value.endsWith('/') && !value.endsWith('.lock');

function expectedGroup({ repository, head, base, headRef, baseRef }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || ![head, base].every(value => typeof value === 'string' && sha.test(value)) || head === base) {
    throw new Error('Merge-group qualification requires a repository and distinct exact head/base commit SHAs');
  }
  if (!branchRef(headRef) || !headRef.startsWith('refs/heads/gh-readonly-queue/') ||
      !branchRef(baseRef) || baseRef.startsWith('refs/heads/gh-readonly-queue/')) {
    throw new Error('Merge-group qualification requires explicit queue and target branch refs');
  }
  return { repository, head, base, headRef, baseRef };
}

/** Read committed topology without replacement refs or unbounded Git commands. */
export function groupGit(args, root) {
  const child = spawnSync('git', ['--no-replace-objects', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
  });
  if (child.status !== 0) throw new Error(child.error?.message || child.stderr?.trim() || 'Cannot read merge-group commits');
  return child.stdout.trim();
}

/** Each supported queue step merges exactly one PR head into its preceding tree. */
export function groupContributions({ root, head, base }) {
  if (![head, base].every(value => typeof value === 'string' && sha.test(value)) || head === base) throw new Error('Invalid merge-group commit pins');
  const entries = [], seen = new Set();
  let commit = head;
  while (commit !== base) {
    if (seen.has(commit) || entries.length === limit) throw new Error('Merge-group history exceeds the supported constituent bound');
    seen.add(commit);
    const parents = groupGit(['show', '-s', '--format=%P', commit], root).split(' ');
    if (parents.length !== 2 || parents.some(parent => !sha.test(parent))) {
      throw new Error('Unsupported merge-group topology: each step must have exactly two parents ending at the pinned base');
    }
    entries.unshift({ commit, parent: parents[0], head: parents[1] });
    commit = parents[0];
  }
  if (new Set(entries.map(entry => entry.head)).size !== entries.length) throw new Error('Duplicate constituent head in merge group');
  return entries;
}

async function verifyQueueRef(client, expected) {
  const ref = await client.ref(expected.headRef.slice('refs/heads/'.length));
  if (ref?.object?.sha !== expected.head) throw new Error('Merge-group queue ref moved or disappeared; dispatch again with current pins');
}

async function associatedRequests(client, head) {
  const result = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await client.api('GET', `commits/${head}/pulls?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Missing authoritative constituent PR list');
    result.push(...batch);
    if (batch.length < 100) return result;
  }
  throw new Error('Constituent PR lookup exceeds the supported pagination bound');
}

/** Resolve every actual second parent; a queue branch name never supplies PR identity. */
export async function resolveMergeGroupContext({ client, root = process.cwd(), ...input }) {
  const expected = expectedGroup(input);
  await verifyQueueRef(client, expected);
  const contributions = groupContributions({ root, ...expected });
  const entries = [], numbers = new Set();
  for (const contribution of contributions) {
    const matches = (await associatedRequests(client, contribution.head)).filter(request =>
      request.state === 'open' && request.head?.sha === contribution.head &&
      request.base?.repo?.full_name === expected.repository && request.base?.ref === expected.baseRef.slice('refs/heads/'.length));
    if (matches.length !== 1) throw new Error(`Constituent ${contribution.head} must resolve to exactly one open PR targeting this repository/branch`);
    const request = await client.api('GET', `pulls/${matches[0].number}`);
    if (request.base?.ref !== expected.baseRef.slice('refs/heads/'.length)) throw new Error('Constituent target branch changed');
    const normalized = normalizePlanningContext({ request, repository: expected.repository, number: matches[0].number,
      head: contribution.head, base: expected.base });
    if (numbers.has(normalized.number)) throw new Error('Duplicate PR in merge group');
    numbers.add(normalized.number);
    entries.push({ ...contribution, pull_request: { ...normalized.pull_request,
      base: { ...normalized.pull_request.base, ref: request.base.ref } } });
  }
  await verifyQueueRef(client, expected);
  return { schemaVersion: 1, source: 'github-api', kind: 'merge-group', ...expected, entries };
}

/** Reject omitted/reordered entries and a different checkout before claims or commands. */
export function validateMergeGroupContext({ context, root = process.cwd(), repository }) {
  if (context?.schemaVersion !== 1 || context.source !== 'github-api' || context.kind !== 'merge-group') {
    throw new Error('Missing authoritative merge-group qualification context');
  }
  const expected = expectedGroup(context);
  if (repository && repository !== expected.repository) throw new Error('Merge-group context belongs to another repository');
  if (groupGit(['rev-parse', 'HEAD'], root) !== expected.head) throw new Error('Checkout does not match the merge-group head');
  const contributions = groupContributions({ root, ...expected });
  if (!Array.isArray(context.entries) || context.entries.length !== contributions.length) throw new Error('Merge-group constituent membership changed');
  const entries = context.entries.map((entry, index) => {
    const { commit, parent, head } = entry;
    if (!isDeepStrictEqual({ commit, parent, head }, contributions[index])) throw new Error('Merge-group constituent order or commit changed');
    if (entry.pull_request?.base?.ref !== expected.baseRef.slice('refs/heads/'.length)) throw new Error('Constituent target branch changed');
    const normalized = normalizePlanningContext({ request: entry.pull_request, repository: expected.repository,
      number: entry.pull_request.number, head, base: expected.base });
    return { commit, parent, head, pull_request: { ...normalized.pull_request,
      base: { ...normalized.pull_request.base, ref: entry.pull_request.base.ref } } };
  });
  if (new Set(entries.map(entry => entry.pull_request.number)).size !== entries.length) throw new Error('Duplicate PR in merge group');
  return { schemaVersion: 1, source: 'github-api', kind: 'merge-group', ...expected, entries };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: {
    root: { type: 'string', default: '.' }, output: { type: 'string', default: 'artifacts/merge-group.json' },
    event: { type: 'string' },
  } });
  try {
    const event = values.event ? JSON.parse(readFileSync(values.event, 'utf8')).merge_group : undefined;
    const repository = process.env.GITHUB_REPOSITORY;
    const [owner, repo] = (repository ?? '').split('/');
    const context = await resolveMergeGroupContext({ client: new GitHubProject({ owner, repo }), root: resolve(values.root), repository,
      head: event?.head_sha ?? process.env.PLANNING_HEAD_SHA, base: event?.base_sha ?? process.env.PLANNING_BASE_SHA,
      headRef: event?.head_ref ?? process.env.PLANNING_HEAD_REF, baseRef: event?.base_ref ?? process.env.PLANNING_BASE_REF });
    mkdirSync(dirname(values.output), { recursive: true });
    writeFileSync(values.output, JSON.stringify(context, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `head_sha=${context.head}\nbase_sha=${context.base}\n`);
    console.log(JSON.stringify(context));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
