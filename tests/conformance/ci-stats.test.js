import test from 'node:test';
import assert from 'node:assert/strict';
import { ciStatistics, collectRuns, percentile, statsMarkdown } from '../../scripts/conformance/ci-stats.js';
const budget = { schemaVersion: 1, workflow: '.github/workflows/ci.yml', minimumSamples: 1, maxP95Seconds: 1200, maxQueueP95Seconds: 600 };
const run = (id, duration = 30) => ({ id, run_attempt: 1, head_sha: 'a'.repeat(40), event: 'pull_request', status: 'completed', conclusion: 'success',
  path: budget.workflow, created_at: '2026-10-01T00:00:00Z', run_started_at: '2026-10-01T00:00:05Z',
  updated_at: new Date(Date.parse('2026-10-01T00:00:00Z') + duration * 1000).toISOString(),
  jobs: [{ id: id * 100, run_id: id, head_sha: 'a'.repeat(40), name: 'core', started_at: '2026-10-01T00:00:05Z', completed_at: '2026-10-01T00:00:30Z', conclusion: 'success' }],
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

function attempted(number, duration, conclusion = 'success') {
  const value = { ...run(1, number * 60), run_attempt: number, conclusion };
  const started = Date.parse('2026-10-01T00:00:05Z') + (number - 1) * 60000;
  value.run_started_at = new Date(started).toISOString();
  value.jobs = [{ ...value.jobs[0], id: 100 + number, conclusion,
    started_at: new Date(started).toISOString(), completed_at: new Date(started + duration * 1000).toISOString() }];
  return value;
}

function historyRequest(attempts, paths = []) {
  return async request => {
    paths.push(request.path);
    const match = request.path.match(/\/runs\/1\/attempts\/(\d+)(\/jobs\?[^#]+)?$/);
    if (!match) return { workflow_runs: [structuredClone(attempts.at(-1))] };
    const attempt = attempts[Number(match[1]) - 1];
    return match[2] ? { jobs: structuredClone(attempt.jobs) } : structuredClone(attempt);
  };
}

test('failed earlier attempts survive capture and contribute job time without adding PR samples', async () => {
  const attempts = [attempted(1, 40, 'failure'), attempted(2, 10)], paths = [];
  const captured = await collectRuns({ repository: 'test/repo', since: '2026-10-01', request: historyRequest(attempts, paths) });
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].attempts.map(attempt => [attempt.run_attempt, attempt.conclusion]), [[1, 'failure'], [2, 'success']]);
  assert.equal(captured[0].attempts[0].head_sha, captured[0].head_sha);
  assert.deepEqual(captured[0].jobs, attempts[1].jobs);
  assert(paths.includes('repos/test/repo/actions/runs/1/attempts/1'));
  assert.equal(paths.filter(path => path.includes('/jobs?')).length, 2);
  const report = ciStatistics(captured, budget), workflow = report.workflows[0];
  assert.equal(report.passed, true);
  assert.equal(workflow.duration.samples, 1);
  assert.equal(workflow.attempts, 2);
  assert.equal(workflow.recordedJobSeconds, 50);
  assert.deepEqual(workflow.jobs[0], { name: 'core', samples: 2, p50Seconds: 10, p95Seconds: 40 });
  assert.match(statsMarkdown(report), /Attempts \| Recorded job seconds/);
  assert.match(statsMarkdown(report), /\| 2 \| 50 \|/);
});

test('partial reruns retain carried jobs but count each recorded execution once', () => {
  const first = attempted(1, 40, 'failure'), second = attempted(2, 10);
  second.jobs.unshift(structuredClone(first.jobs[0]));
  const latest = { ...second, attempts: [first, second] };
  const workflow = ciStatistics([latest], budget).workflows[0];
  assert.equal(workflow.recordedJobSeconds, 50);
  assert.equal(workflow.jobs[0].samples, 2);
  assert.equal(latest.attempts[1].jobs.length, 2);
  second.jobs[0].completed_at = '2026-10-01T00:00:46Z';
  assert.throws(() => ciStatistics([latest], budget), /Conflicting snapshots/);
});

test('missing or misordered historical attempts cannot silently produce complete statistics', () => {
  const first = attempted(1, 40), second = attempted(2, 10);
  assert.throws(() => ciStatistics([second], budget), /Incomplete CI attempt history/);
  for (const attempts of [[second, first], [first, { ...second, head_sha: 'b'.repeat(40) }],
    [first, { ...second, id: 2 }], [first, { ...second, path: '.github/workflows/other.yml' }]]) {
    assert.throws(() => ciStatistics([{ ...second, attempts }], budget), /does not match/);
  }
  assert.throws(() => ciStatistics([first, { ...second, attempts: [first, second] }], budget), /Duplicate/);
});

test('capture rejects mismatched historical workflow metadata before accepting its jobs', async () => {
  const attempts = [attempted(1, 40), attempted(2, 10)];
  for (const patch of [{ id: 2 }, { run_attempt: 2 }, { head_sha: 'b'.repeat(40) },
    { path: '.github/workflows/other.yml' }, { event: 'push' }, { status: 'in_progress' }]) {
    const request = historyRequest(attempts);
    await assert.rejects(collectRuns({ repository: 'test/repo', since: '2026-10-01', request: async input => {
      const result = await request(input);
      return input.path.endsWith('/attempts/1') ? { ...result, ...patch } : result;
    } }), /pinned run identity/);
  }
});

test('aggregate attempt bounds fail before fetching jobs and malformed or duplicate jobs fail closed', async () => {
  const attempts = [attempted(1, 40), attempted(2, 10)], paths = [];
  await assert.rejects(collectRuns({ repository: 'test/repo', since: '2026-10-01', maxAttempts: 1,
    request: historyRequest(attempts, paths) }), /attempt history exceeds capture bound/);
  assert.equal(paths.length, 1);
  for (const jobs of [[attempts[0].jobs[0], attempts[0].jobs[0]],
    [{ ...attempts[0].jobs[0], run_id: 2 }], [{ ...attempts[0].jobs[0], head_sha: 'b'.repeat(40) }]]) {
    const request = historyRequest(attempts);
    await assert.rejects(collectRuns({ repository: 'test/repo', since: '2026-10-01', request: async input =>
      input.path.includes('/attempts/1/jobs?') ? { jobs } : request(input) }), /attempt job identity/);
  }
});

test('each attempt independently follows job pagination', async () => {
  const attempts = [attempted(1, 40), attempted(2, 10)], request = historyRequest(attempts), pages = [];
  const captured = await collectRuns({ repository: 'test/repo', since: '2026-10-01', request: async input => {
    const match = input.path.match(/\/attempts\/(\d+)\/jobs\?per_page=100&page=(\d+)$/);
    if (!match) return request(input);
    const attempt = Number(match[1]), page = Number(match[2]); pages.push([attempt, page]);
    return { jobs: Array.from({ length: page === 1 ? 100 : 1 }, (_, index) => ({
      ...attempts[attempt - 1].jobs[0], id: attempt * 1000 + (page - 1) * 100 + index,
    })) };
  } });
  assert.deepEqual(pages, [[1, 1], [1, 2], [2, 1], [2, 2]]);
  assert.deepEqual(captured[0].attempts.map(attempt => attempt.jobs.length), [101, 101]);
});

test('cancelled jobs that never started have no invented execution duration', () => {
  const value = run(1);
  value.jobs[0] = { ...value.jobs[0], conclusion: 'cancelled', started_at: null, completed_at: null };
  const workflow = ciStatistics([value], budget).workflows[0];
  assert.equal(workflow.recordedJobSeconds, 0);
  assert.equal(workflow.jobs[0].samples, 0);
  assert.equal(workflow.jobs[0].p95Seconds, null);
});

test('initial PR queue excludes rerun delay while lifecycle ends at latest completion', async () => {
  const first = attempted(1, 40, 'failure'), second = attempted(2, 10);
  second.run_started_at = '2026-10-01T00:15:05Z';
  second.updated_at = '2026-10-01T00:15:30Z';
  second.jobs[0].started_at = second.run_started_at;
  second.jobs[0].completed_at = '2026-10-01T00:15:15Z';
  const captured = await collectRuns({ repository: 'test/repo', since: '2026-10-01', request: historyRequest([first, second]) });
  const report = ciStatistics(captured, { ...budget, maxQueueP95Seconds: 5 }), workflow = report.workflows[0];
  assert.equal(captured[0].run_started_at, second.run_started_at);
  assert.equal(captured[0].attempts[0].run_started_at, first.run_started_at);
  assert.deepEqual(workflow.queue, { samples: 1, p50Seconds: 5, p95Seconds: 5 });
  assert.deepEqual(workflow.duration, { samples: 1, p50Seconds: 930, p95Seconds: 930 });
  assert.equal(workflow.recordedJobSeconds, 50);
  assert.equal(report.passed, true);
  assert.equal(ciStatistics(captured, { ...budget, maxQueueP95Seconds: 4 }).passed, false);
  assert.match(statsMarkdown(report), /Initial queue p50/);
});

test('initial queue accepts an immediate start and rejects invalid first-attempt timestamps', () => {
  const first = attempted(1, 40, 'failure'), second = attempted(2, 10);
  const latest = { ...second, attempts: [first, second] };
  first.run_started_at = first.created_at;
  assert.deepEqual(ciStatistics([latest], budget).workflows[0].queue, { samples: 1, p50Seconds: 0, p95Seconds: 0 });
  for (const value of [undefined, null, 'invalid', '2026-09-30T23:59:59Z']) {
    first.run_started_at = value;
    assert.throws(() => ciStatistics([latest], budget), /timestamps/);
  }
});
