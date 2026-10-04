import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { GitHubProject } from '../../planning/lib/github-project.js';
import { reviewContext } from '../../planning/review-gates.js';
import { isMain } from '../../planning/lib/io.js';

function expectedContext({ number, head, base, repository }) {
  if (!/^[1-9][0-9]*$/.test(String(number ?? '')) || !Number.isSafeInteger(Number(number))) {
    throw new Error('Planning qualification requires an explicit PR number');
  }
  if (![head, base].every(value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value))) {
    throw new Error('Planning qualification requires exact head and base commit SHAs');
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Invalid qualification repository');
  return { number: Number(number), head, base, repository };
}

/** Normalize only an authoritative API response matching every caller-pinned identity. */
export function normalizePlanningContext({ request, ...input }) {
  const expected = expectedContext(input);
  if (request?.number !== expected.number || request.state !== 'open' || request.base?.repo?.full_name !== expected.repository) {
    throw new Error('PR identity, repository or open state does not match the requested qualification');
  }
  if (request.head?.sha !== expected.head || request.base?.sha !== expected.base) {
    throw new Error('PR head/base changed; dispatch again with the current immutable SHAs');
  }
  if (typeof request.head.ref !== 'string' || !request.head.ref ||
      !/^[\w.-]+\/[\w.-]+$/.test(request.head.repo?.full_name ?? '')) {
    throw new Error('PR head branch/repository metadata is missing');
  }
  if (request.body !== null && request.body !== undefined && typeof request.body !== 'string') throw new Error('Invalid PR body');
  if (!Array.isArray(request.labels) || request.labels.some(label => typeof label?.name !== 'string' || !label.name)) {
    throw new Error('PR labels must be the authoritative API snapshot');
  }
  return {
    schemaVersion: 1, source: 'github-api', ...expected,
    pull_request: {
      number: request.number, state: request.state, body: request.body ?? '',
      base: { sha: expected.base, repo: { full_name: expected.repository } },
      head: { sha: expected.head, ref: request.head.ref, repo: { full_name: request.head.repo.full_name } },
      labels: [...new Set(request.labels.map(label => label.name))].sort().map(name => ({ name })),
    },
  };
}

export async function resolvePlanningContext({ client, ...input }) {
  const expected = expectedContext(input);
  const request = await client.api('GET', `pulls/${expected.number}`);
  return normalizePlanningContext({ request, ...expected });
}

/** Refuse missing context and validate the API snapshot against the actual PR checkout. */
export function validatePlanningContext({ context, root, repository }) {
  if (context?.schemaVersion !== 1 || context.source !== 'github-api') throw new Error('Missing authoritative PR qualification context');
  if (repository && context.repository !== repository) throw new Error('Qualification context belongs to another repository');
  const normalized = normalizePlanningContext({ ...context, request: context.pull_request });
  return { ...normalized, ...reviewContext({ root, event: normalized, eventName: 'pull_request', expectedSha: normalized.head }) };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { output: { type: 'string', default: 'artifacts/planning-pr.json' } } });
  try {
    const repository = process.env.GITHUB_REPOSITORY;
    const [owner, repo] = (repository ?? '').split('/');
    const context = await resolvePlanningContext({ client: new GitHubProject({ owner, repo }), repository,
      number: process.env.PLANNING_PR, head: process.env.PLANNING_HEAD_SHA, base: process.env.PLANNING_BASE_SHA });
    mkdirSync(dirname(values.output), { recursive: true });
    writeFileSync(values.output, JSON.stringify(context, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `head_sha=${context.head}\n`);
    console.log(JSON.stringify(context));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
