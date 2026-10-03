import { appendFileSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { ghTransport } from '../planning/lib/gh-retry.js';
import { isMain } from '../planning/lib/io.js';

const seconds = (start, end) => {
  const value = (Date.parse(end) - Date.parse(start)) / 1000;
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid or inverted CI timestamps');
  return value;
};
export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
const distribution = values => ({ samples: values.length, p50Seconds: percentile(values, 0.5), p95Seconds: percentile(values, 0.95) });

export function ciStatistics(runs, budget) {
  if (budget?.schemaVersion !== 1 || !Number.isInteger(budget.minimumSamples) || budget.minimumSamples < 1 ||
      ![budget.maxP95Seconds, budget.maxQueueP95Seconds].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Invalid CI budget');
  }
  const groups = new Map(), identities = new Set();
  for (const run of runs) {
    if (run.event !== 'pull_request' || run.status !== 'completed') continue;
    const identity = `${run.id}:${run.run_attempt}`;
    if (identities.has(identity)) throw new Error('Duplicate CI run attempt');
    identities.add(identity);
    if (!/^[a-f0-9]{40}$/.test(run.head_sha ?? '') || !Array.isArray(run.jobs)) throw new Error('CI run lacks commit or jobs');
    const path = run.path.split('@')[0];
    const group = groups.get(path) ?? { path, durations: [], queues: [], jobs: new Map(), runs: [] };
    group.durations.push(seconds(run.created_at, run.updated_at));
    group.queues.push(seconds(run.created_at, run.run_started_at));
    group.runs.push({ id: run.id, attempt: run.run_attempt, commit: run.head_sha, conclusion: run.conclusion });
    for (const job of run.jobs) {
      const samples = group.jobs.get(job.name) ?? [];
      if (job.conclusion !== 'skipped') samples.push(seconds(job.started_at, job.completed_at));
      group.jobs.set(job.name, samples);
    }
    groups.set(path, group);
  }
  const workflows = [...groups.values()].sort((left, right) => left.path.localeCompare(right.path)).map(group => ({
    path: group.path, duration: distribution(group.durations), queue: distribution(group.queues), runs: group.runs,
    jobs: [...group.jobs].sort(([left], [right]) => left.localeCompare(right)).map(([name, values]) => ({ name, ...distribution(values) })),
  }));
  const primary = workflows.find(workflow => workflow.path === budget.workflow);
  const errors = [];
  if (!primary || primary.duration.samples < budget.minimumSamples) errors.push('Insufficient completed PR samples; budget status unknown');
  else {
    if (primary.duration.p95Seconds > budget.maxP95Seconds) errors.push(`PR p95 exceeds ${budget.maxP95Seconds}s budget`);
    if (primary.queue.p95Seconds > budget.maxQueueP95Seconds) errors.push(`PR queue p95 exceeds ${budget.maxQueueP95Seconds}s budget`);
  }
  return { schemaVersion: 1, workflows, budget, passed: errors.length === 0, errors };
}

export async function collectRuns({ repository, since, request = ghTransport(), maxRuns = 1000 }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Invalid repository');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? '')) throw new Error('Invalid capture date');
  const prefix = `repos/${repository}`;
  const runs = [];
  for (let page = 1; ; page++) {
    const result = await request({ path: `${prefix}/actions/runs?event=pull_request&status=completed&created=%3E%3D${since}&per_page=100&page=${page}` });
    if (!Array.isArray(result.workflow_runs)) throw new Error('Missing workflow run data');
    runs.push(...result.workflow_runs);
    if (runs.length > maxRuns) throw new Error('CI history exceeds capture bound; narrow the date window');
    if (result.workflow_runs.length < 100) break;
  }
  for (const run of runs) {
    run.jobs = [];
    for (let page = 1; ; page++) {
      const result = await request({ path: `${prefix}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}` });
      if (!Array.isArray(result.jobs)) throw new Error('Missing job data');
      run.jobs.push(...result.jobs);
      if (run.jobs.length > 1000) throw new Error('CI job history exceeds capture bound');
      if (result.jobs.length < 100) break;
    }
  }
  return runs;
}

export function statsMarkdown(report) {
  const cell = value => String(value ?? 'unknown').replaceAll('|', '\\|').replaceAll('\n', ' ');
  return '# Weekly PR CI timing\n\n| Workflow | Samples | Total p50 / p95 (s) | Queue p50 / p95 (s) |\n' +
    '| --- | ---: | ---: | ---: |\n' + report.workflows.map(row =>
      `| ${cell(row.path)} | ${row.duration.samples} | ${row.duration.p50Seconds} / ${row.duration.p95Seconds} | ` +
      `${row.queue.p50Seconds} / ${row.queue.p95Seconds} |`).join('\n') +
    `\n\nBudget: ${report.passed ? 'pass' : 'fail/unknown'}\n\n${report.errors.map(error => '- ' + cell(error)).join('\n')}\n`;
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, output: { type: 'string', default: 'artifacts/ci-stats.json' },
    budget: { type: 'string', default: 'planning/qualification/ci-budget.json' },
  } });
  try {
    const budget = JSON.parse(readFileSync(values.budget, 'utf8'));
    const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const runs = values.input ? JSON.parse(readFileSync(values.input, 'utf8')) : await collectRuns({ repository: process.env.GITHUB_REPOSITORY, since });
    const report = { ...ciStatistics(runs, budget), capturedAt: new Date().toISOString(), since, rawRuns: runs };
    mkdirSync(dirname(values.output), { recursive: true });
    writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
    writeFileSync(values.output + '.md', statsMarkdown(report));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, statsMarkdown(report));
    console.log(JSON.stringify({ passed: report.passed, errors: report.errors, workflows: report.workflows.length }));
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
