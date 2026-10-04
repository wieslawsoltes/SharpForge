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

function attemptHistory(run) {
  if (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) throw new Error('Invalid CI attempt number');
  const attempts = run.attempts ?? (run.run_attempt === 1 ? [run] : null);
  if (!Array.isArray(attempts) || attempts.length !== run.run_attempt) throw new Error('Incomplete CI attempt history');
  for (const [index, attempt] of attempts.entries()) {
    if (attempt.id !== run.id || attempt.run_attempt !== index + 1 || attempt.head_sha !== run.head_sha ||
        attempt.path?.split('@')[0] !== run.path?.split('@')[0] || attempt.event !== run.event || attempt.status !== 'completed' ||
        !Array.isArray(attempt.jobs)) throw new Error('CI attempt history does not match the captured run');
  }
  return attempts;
}

export function ciStatistics(runs, budget) {
  if (budget?.schemaVersion !== 1 || !Number.isInteger(budget.minimumSamples) || budget.minimumSamples < 1 ||
      ![budget.maxP95Seconds, budget.maxQueueP95Seconds].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Invalid CI budget');
  }
  const groups = new Map(), identities = new Set();
  for (const run of runs) {
    if (run.event !== 'pull_request' || run.status !== 'completed') continue;
    const identity = run.id;
    if (identities.has(identity)) throw new Error('Duplicate CI run or attempt');
    identities.add(identity);
    if (!/^[a-f0-9]{40}$/.test(run.head_sha ?? '') || !Array.isArray(run.jobs)) throw new Error('CI run lacks commit or jobs');
    const attempts = attemptHistory(run), countedJobs = new Map();
    const path = run.path.split('@')[0];
    const group = groups.get(path) ?? { path, durations: [], queues: [], jobs: new Map(), runs: [], attempts: 0, jobSeconds: 0 };
    group.durations.push(seconds(run.created_at, run.updated_at));
    // GitHub resets run_started_at on rerun; only attempt 1 measures the initial queue.
    group.queues.push(seconds(run.created_at, attempts[0].run_started_at));
    group.runs.push({ id: run.id, attempt: run.run_attempt, commit: run.head_sha, conclusion: run.conclusion });
    group.attempts += attempts.length;
    for (const attempt of attempts) for (const job of attempt.jobs) {
      // A carried-forward successful job in a partial rerun is still one execution.
      const execution = JSON.stringify([job.name, job.started_at, job.completed_at, job.conclusion]);
      if (job.id !== undefined && countedJobs.has(job.id)) {
        if (countedJobs.get(job.id) !== execution) throw new Error('Conflicting snapshots for the same CI job execution');
        continue;
      }
      if (job.id !== undefined) countedJobs.set(job.id, execution);
      const samples = group.jobs.get(job.name) ?? [];
      if (job.conclusion !== 'skipped' && !(job.conclusion === 'cancelled' && !job.started_at && !job.completed_at)) {
        const duration = seconds(job.started_at, job.completed_at);
        samples.push(duration); group.jobSeconds += duration;
      }
      group.jobs.set(job.name, samples);
    }
    groups.set(path, group);
  }
  const workflows = [...groups.values()].sort((left, right) => left.path.localeCompare(right.path)).map(group => ({
    path: group.path, duration: distribution(group.durations), queue: distribution(group.queues), runs: group.runs,
    attempts: group.attempts, recordedJobSeconds: group.jobSeconds,
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

export async function collectRuns({ repository, since, request = ghTransport(), maxRuns = 1000, maxAttempts = 1000 }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Invalid repository');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? '')) throw new Error('Invalid capture date');
  if (![maxRuns, maxAttempts].every(value => Number.isSafeInteger(value) && value > 0 && value <= 10000)) throw new Error('Invalid CI capture bounds');
  const prefix = `repos/${repository}`;
  const runs = [];
  for (let page = 1; ; page++) {
    const result = await request({ path: `${prefix}/actions/runs?event=pull_request&status=completed&created=%3E%3D${since}&per_page=100&page=${page}` });
    if (!Array.isArray(result.workflow_runs)) throw new Error('Missing workflow run data');
    runs.push(...result.workflow_runs);
    if (runs.length > maxRuns) throw new Error('CI history exceeds capture bound; narrow the date window');
    if (result.workflow_runs.length < 100) break;
  }
  const identities = new Set();
  let attemptCount = 0;
  for (const run of runs) {
    if (!Number.isSafeInteger(run.id) || run.id < 1 || identities.has(run.id) ||
        !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 ||
        !/^[a-f0-9]{40}$/.test(run.head_sha ?? '') || typeof run.path !== 'string' ||
        run.event !== 'pull_request' || run.status !== 'completed') throw new Error('Invalid or duplicate captured CI run');
    identities.add(run.id);
    attemptCount += run.run_attempt;
    if (attemptCount > maxAttempts) throw new Error('CI attempt history exceeds capture bound; narrow the date window');
  }
  for (const run of runs) {
    const attempts = [];
    for (let number = 1; number <= run.run_attempt; number++) {
      const attempt = number === run.run_attempt ? { ...run } : await request({
        path: `${prefix}/actions/runs/${run.id}/attempts/${number}`,
      });
      if (attempt?.id !== run.id || attempt.run_attempt !== number || attempt.head_sha !== run.head_sha ||
          attempt.path?.split('@')[0] !== run.path.split('@')[0] || attempt.event !== run.event || attempt.status !== 'completed') {
        throw new Error('Workflow attempt does not match the pinned run identity');
      }
      const jobs = [], jobIds = new Set();
      for (let page = 1; ; page++) {
        const result = await request({ path: `${prefix}/actions/runs/${run.id}/attempts/${number}/jobs?per_page=100&page=${page}` });
        if (!Array.isArray(result.jobs)) throw new Error('Missing job data');
        for (const job of result.jobs) {
          if (!Number.isSafeInteger(job.id) || job.id < 1 || jobIds.has(job.id) || job.run_id !== run.id || job.head_sha !== run.head_sha) {
            throw new Error('Duplicate or mismatched attempt job identity');
          }
          jobIds.add(job.id); jobs.push(job);
        }
        if (jobs.length > 1000) throw new Error('CI job history exceeds capture bound');
        if (result.jobs.length < 100) break;
      }
      attempts.push({ ...attempt, jobs });
    }
    run.jobs = attempts.at(-1).jobs;
    run.attempts = attempts;
  }
  return runs;
}

export function statsMarkdown(report) {
  const cell = value => String(value ?? 'unknown').replaceAll('|', '\\|').replaceAll('\n', ' ');
  return '# Weekly PR CI timing\n\n| Workflow | PR runs | Total p50 / p95 (s) | Initial queue p50 / p95 (s) | Attempts | Recorded job seconds |\n' +
    '| --- | ---: | ---: | ---: | ---: | ---: |\n' + report.workflows.map(row =>
      `| ${cell(row.path)} | ${row.duration.samples} | ${row.duration.p50Seconds} / ${row.duration.p95Seconds} | ` +
      `${row.queue.p50Seconds} / ${row.queue.p95Seconds} | ${row.attempts} | ${row.recordedJobSeconds} |`).join('\n') +
    '\n\nPR lifecycle budgets count each run once; initial queue time ends at the first attempt start, and job durations include every captured attempt. Recorded job seconds are elapsed execution time, not billed cost.\n' +
    `\nBudget: ${report.passed ? 'pass' : 'fail/unknown'}\n\n${report.errors.map(error => '- ' + cell(error)).join('\n')}\n`;
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
