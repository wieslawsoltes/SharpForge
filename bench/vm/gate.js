import {validateReport, compatibleReports} from './report-validation.js';
import {distribution, quantile, bootstrapRegression, validateBootstrapOptions, exceeds, requireSamples} from './statistics.js';
import {stable} from './evidence.js';

const probabilities = {median: 0.5, p95: 0.95, p99: 0.99};
const observations = (row, key) => row.samples.filter(sample => sample.phase === 'measured').map(sample => sample[key]);

/** The same statistical decision path is shared by report comparisons and measured-handler regression tests. */
export function compareMetric(baseline, candidate, options = {}) {
  const configuration = validateBootstrapOptions(options);
  requireSamples(baseline, 20);
  requireSamples(candidate, 20);
  const {probability, direction, threshold} = configuration;
  if (direction === 'lower' && [...baseline, ...candidate].some(value => value <= 0)) throw new RangeError('Zero throughput is unmeasured');
  const before = quantile(baseline, probability);
  const after = quantile(candidate, probability);
  const budgetExcess = direction === 'higher' ? after / (1 + threshold) - before : before * (1 - threshold) - after;
  if (exceeds(budgetExcess, 0)) return bootstrapRegression(baseline, candidate, configuration);
  const observed = before === 0 ? after : direction === 'higher' ? after / before - 1 : 1 - after / before;
  return {before, after, observed, threshold: before === 0 ? 0 : threshold, unit: before === 0 ? 'absolute' : 'fraction',
    budgetExcess, decision: 'within-budget', regression: false, reason: 'Point estimate does not exceed the regression threshold'};
}

export function qualifyBaseline(first, second, options = {}) {
  if (first?.status !== 'measured' || second?.status !== 'measured') throw new TypeError('Qualification requires two measured runs');
  const left = validateReport(first, options);
  const right = validateReport(second, options);
  compatibleReports(first, second);
  if (first.commit !== second.commit) throw new TypeError('Qualification repeats must measure the same commit');
  if (Date.parse(first.completedAt) >= Date.parse(second.startedAt)) throw new TypeError('Qualification requires two separate serial runs');
  const stability = [];
  for (const [id, row] of left) {
    if (row.status === 'unsupported') continue;
    for (const key of Object.keys(row.metrics)) {
      const before = distribution(observations(row, key));
      const after = distribution(observations(right.get(id), key));
      const change = before.median === 0 ? after.median === 0 ? 0 : Infinity : Math.abs(after.median / before.median - 1);
      stability.push({id, metric: key, before, after, fractionalDifference: Number.isFinite(change) ? change : null,
        stable: Number.isFinite(change) && !exceeds(change, 0.05)});
    }
  }
  if (stability.some(entry => !entry.stable)) {
    throw Object.assign(new Error('Repeat-run medians differ by more than 5%'), {stability});
  }
  return {...second, status: 'qualified', qualification: {status: 'stable', rule: 'all same-runner medians within 5%',
    repeat: first, stability, qualifiedAt: new Date().toISOString()}};
}

export function comparePerformance(baseline, candidate, options = {}) {
  const left = validateReport(baseline, {...options, baseline: true});
  const right = validateReport(candidate, options);
  // Reconstruct qualification from retained raw repeats instead of trusting a manually edited status flag.
  const qualified = qualifyBaseline(baseline.qualification.repeat, {...baseline, status: 'measured', qualification: undefined}, options);
  if (stable(qualified.qualification.stability) !== stable(baseline.qualification.stability) ||
      baseline.qualification.rule !== qualified.qualification.rule ||
      !Number.isFinite(Date.parse(baseline.qualification.qualifiedAt)) ||
      Date.parse(baseline.qualification.qualifiedAt) < Date.parse(baseline.completedAt)) {
    throw new TypeError('Retained baseline qualification evidence differs from raw observations');
  }
  compatibleReports(baseline, candidate);
  const configuration = validateBootstrapOptions(options);
  const results = [];
  for (const [id, row] of left) {
    if (row.status === 'unsupported') continue;
    const next = right.get(id);
    for (const [key, metric] of Object.entries(row.metrics)) for (const statistic of metric.statistics) {
      const comparison = compareMetric(observations(row, key), observations(next, key),
        {...configuration, probability: probabilities[statistic], direction: metric.direction});
      results.push({id, metric: key, statistic, metricUnit: metric.unit, ...comparison});
    }
  }
  return {schemaVersion: 2, suite: 'SF-A05-T12', status: results.some(item => item.regression) ? 'regression' : 'passed',
    baselineCommit: baseline.commit, candidateCommit: candidate.commit, environmentFingerprint: candidate.environmentFingerprint,
    harnessHash: candidate.harnessHash, threshold: configuration.threshold, confidence: configuration.confidence,
    resamples: configuration.resamples, seed: configuration.seed,
    inconclusive: results.filter(item => item.decision === 'inconclusive').length,
    unsupported: [...left.values()].filter(row => row.status === 'unsupported').map(row => ({id: row.id, reason: row.reason})),
    unavailablePhases: [...left.values()].filter(row => Object.keys(row.unavailableMetrics).length)
      .map(row => ({id: row.id, metrics: row.unavailableMetrics})),
    multiplicity: 'Per-metric two-sided confidence; no family-wise claim',
    method: 'Independent percentile bootstrap of metric-unit excess over regression budget', results};
}
