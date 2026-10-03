import test from 'node:test';
import assert from 'node:assert/strict';
import { ciStatistics, collectRuns, percentile, statsMarkdown } from '../../scripts/conformance/ci-stats.js';
const budget = { schemaVersion: 1, workflow: '.github/workflows/ci.yml', minimumSamples: 1, maxP95Seconds: 1200, maxQueueP95Seconds: 600 };
const run = (id, duration = 30) => ({ id, run_attempt: 1, head_sha: 'a'.repeat(40), event: 'pull_request', status: 'completed', conclusion: 'success',
  path: budget.workflow, created_at: '2026-10-01T00:00:00Z', run_started_at: '2026-10-01T00:00:05Z',
  updated_at: new Date(Date.parse('2026-10-01T00:00:00Z') + duration * 1000).toISOString(),
  jobs: [{ name: 'core', started_at: '2026-10-01T00:00:05Z', completed_at: '2026-10-01T00:00:30Z', conclusion: 'success' }],
});
test('CI distributions include queue and per-job data and expose breaches', () => {
  const report = ciStatistics([run(1), run(2, 1500)], budget);
  assert.equal(report.passed, false);
  assert.equal(report.workflows[0].duration.p95Seconds, 1500);
  assert.equal(report.workflows[0].queue.p50Seconds, 5);
  assert.equal(report.workflows[0].jobs[0].p95Seconds, 25);
  assert.match(statsMarkdown(report), /PR p95 exceeds/);
  assert.equal(percentile([], 0.95), null);
});
test('insufficient data, duplicate attempts and malformed timestamps never pass', () => {
  assert.equal(ciStatistics([], budget).passed, false);
  assert.throws(() => ciStatistics([run(1), run(1)], budget), /Duplicate/);
  assert.throws(() => ciStatistics([{ ...run(1), run_started_at: 'invalid' }], budget), /timestamps/);
  assert.equal(ciStatistics([run(1)], budget).passed, true);
});
test('collector binds jobs to each run attempt and fails truncated capture', async () => {
  const paths = [];
  const captured = await collectRuns({ repository: 'test/repo', since: '2026-10-01', request: async request => {
    paths.push(request.path);
    return request.path.includes('/jobs?') ? { jobs: run(1).jobs } : { workflow_runs: [run(1)] };
  } });
  assert.equal(captured.length, 1);
  assert(paths.some(path => path.includes('/runs/1/attempts/1/jobs')));
  await assert.rejects(collectRuns({ repository: 'test/repo', since: '2026-10-01', maxRuns: 1,
    request: async () => ({ workflow_runs: [run(1), run(2)] }) }), /capture bound/);
});
