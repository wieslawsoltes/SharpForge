import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';

export const workbenchBudgets = Object.freeze({
  'cold-app-startup': 10000, 'workspace-startup': 10000, 'document-switch': 250, 'tool-activation': 1500
});
const names = Object.keys(workbenchBudgets);
const finiteDuration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const positiveInteger = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
const nonemptyString = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;

function validateEnvironment(environment) {
  if (!environment || !['chromium', 'firefox', 'webkit'].includes(environment.engine) ||
      !['browserVersion', 'operatingSystem', 'architecture', 'servingMode', 'timingProtocol'].every(key => nonemptyString(environment[key])) ||
      !positiveInteger(environment.viewport?.width, 16384) || !positiveInteger(environment.viewport?.height, 16384) ||
      !finiteDuration(environment.deviceScaleFactor) || environment.deviceScaleFactor === 0 ||
      !positiveInteger(environment.hardwareConcurrency, 1024)) throw new TypeError('Invalid trace environment');
}

function validateFixture(fixture) {
  if (!fixture || fixture.id !== 'workbench-501-csharp-v2' || !/^[a-f0-9]{64}$/u.test(fixture.sha256) ||
      fixture.sourceFiles !== 501 || fixture.projectFiles !== 1 || !positiveInteger(fixture.rounds, 30) || fixture.rounds < 3 ||
      !positiveInteger(fixture.documentSwitches, fixture.sourceFiles - 1) || !positiveInteger(fixture.toolPasses, 100) ||
      !Array.isArray(fixture.tools) || !fixture.tools.length || fixture.tools.length > 32 ||
      !fixture.tools.every(nonemptyString) || new Set(fixture.tools).size !== fixture.tools.length) {
    throw new TypeError('Invalid trace fixture or independent startup sample count');
  }
}

function sampleGroups(trace) {
  if (!Array.isArray(trace.samples) || !trace.samples.length || trace.samples.length > 100000) throw new TypeError('Invalid trace samples');
  const groups = new Map(names.map(name => [name, {values: [], rounds: new Uint32Array(trace.fixture.rounds)}]));
  for (const sample of trace.samples) {
    const group = groups.get(sample.name);
    if (!group || sample.sessionId !== 'workbench' || !finiteDuration(sample.duration) ||
        !Number.isSafeInteger(sample.round) || sample.round < 0 || sample.round >= trace.fixture.rounds) {
      throw new TypeError('Invalid trace sample identity, duration or independent round');
    }
    group.values.push(sample.duration);
    group.rounds[sample.round]++;
  }
  const perRound = {'cold-app-startup': 1, 'workspace-startup': 1, 'document-switch': trace.fixture.documentSwitches,
    'tool-activation': trace.fixture.tools.length * trace.fixture.toolPasses};
  for (const [name, group] of groups) {
    if (group.rounds.some(count => count !== perRound[name])) throw new TypeError('Missing or duplicate metric samples: ' + name);
    group.values.sort((left, right) => left - right);
  }
  return groups;
}

/** Validate complete raw captures, recompute percentiles, and reject missing or fabricated metric obligations. */
export function validateWorkbenchTrace(trace) {
  if (!trace || trace.format !== 'sharpforge-workbench-trace' || trace.version !== 2 || trace.units !== 'milliseconds') {
    throw new TypeError('Expected version 2 workbench millisecond traces');
  }
  if (trace.captureStatus !== 'completed' || !Array.isArray(trace.browserErrors) || trace.browserErrors.length) {
    throw new TypeError('Trace capture did not complete without browser errors');
  }
  validateEnvironment(trace.environment);
  validateFixture(trace.fixture);
  const groups = sampleGroups(trace);
  if (!Array.isArray(trace.summary) || trace.summary.length !== names.length) throw new TypeError('Missing or duplicate metric summaries');
  const metrics = new Map();
  for (const metric of trace.summary) {
    const group = groups.get(metric.name);
    if (!group || metrics.has(metric.name) || metric.sessionId !== 'workbench' ||
        metric.count !== group.values.length || !['p50', 'p95', 'p99'].every(key => finiteDuration(metric[key]))) {
      throw new TypeError('Invalid trace metric identity, count or percentile');
    }
    for (const [key, percentile] of [['p50', .5], ['p95', .95], ['p99', .99]]) {
      const expected = group.values[Math.ceil(group.values.length * percentile) - 1];
      if (metric[key] !== expected) throw new TypeError('Trace metric disagrees with raw samples: ' + metric.name + '.' + key);
    }
    metrics.set(metric.name, metric);
  }
  return metrics;
}

function validateBudgets(overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new TypeError('Invalid performance budgets');
  for (const [name, value] of Object.entries(overrides)) {
    if (!names.includes(name) || !finiteDuration(value)) throw new TypeError('Invalid performance budget: ' + name);
  }
  return {...workbenchBudgets, ...overrides};
}

function compareMetrics(current, previous, budgets) {
  return [...current.values()].flatMap(metric => {
    const before = previous?.get(metric.name);
    const limit = Math.min(budgets[metric.name], before ? before.p95 * 1.2 : Infinity);
    return metric.p95 > limit ? [{name: metric.name, sessionId: metric.sessionId, p95: metric.p95, baseline: before?.p95, limit}] : [];
  });
}

/** Compare like-for-like complete captures; absolute budgets and a greater-than-20% relative p95 regression fail. */
export function compareWorkbenchTraces(current, baseline, budgets = {}) {
  const present = validateWorkbenchTrace(current);
  const previous = validateWorkbenchTrace(baseline);
  if (!isDeepStrictEqual(current.environment, baseline.environment)) throw new TypeError('Trace environment differs from baseline');
  if (!isDeepStrictEqual(current.fixture, baseline.fixture)) throw new TypeError('Trace fixture differs from baseline');
  return compareMetrics(present, previous, validateBudgets(budgets));
}

/** Capture-only mode has no relative regression verdict; a compatible prior trace is mandatory for comparison. */
export function assessWorkbenchTrace(current, baseline = null, budgets = {}) {
  const metrics = validateWorkbenchTrace(current);
  const limits = validateBudgets(budgets);
  const absoluteFailures = compareMetrics(metrics, null, limits);
  const failures = baseline ? compareWorkbenchTraces(current, baseline, budgets) : absoluteFailures;
  const regressionVerdict = baseline ? [...metrics.values()].every(metric =>
    metric.p95 <= baseline.summary.find(previous => previous.name === metric.name).p95 * 1.2) : null;
  return {mode: baseline ? 'compare' : 'capture', absolutePassed: absoluteFailures.length === 0, regressionVerdict, failures};
}

if (process.argv[1]?.endsWith('workbench-perf-budget.mjs')) {
  try {
    const capture = process.argv[2] === '--capture';
    const [currentPath, second, third] = process.argv.slice(capture ? 3 : 2);
    const baselinePath = capture ? null : second;
    const budgetsPath = capture ? second : third;
    if (!currentPath || !capture && !baselinePath) {
      throw new Error('Usage: node tests/workbench-perf-budget.mjs [--capture] current.json [baseline.json] [budgets.json]');
    }
    const [current, baseline, budgets] = await Promise.all([currentPath, baselinePath, budgetsPath].map(async path =>
      path ? JSON.parse(await readFile(path, 'utf8')) : null));
    const assessment = assessWorkbenchTrace(current, baseline, budgets ?? {});
    process.stdout.write(JSON.stringify(assessment, null, 2) + '\n');
    process.exitCode = assessment.failures.length ? 1 : 0;
  } catch (error) {
    process.stdout.write(JSON.stringify({mode: 'invalid', regressionVerdict: null, error: error.message}, null, 2) + '\n');
    process.exitCode = 1;
  }
}
