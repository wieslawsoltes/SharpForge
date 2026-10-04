import {validateReport, compatibleReports} from './report-validation.js';
import {median, quantile, bootstrapRegression, randomGenerator, exceeds} from './statistics.js';
import {stable} from './evidence.js';

const probabilities = {median: 0.5, p95: 0.95, p99: 0.99};
const observations = (row, key) => row.samples.filter(sample => sample.phase === 'measured').map(sample => sample[key]);

export function qualifyBaseline(first, second) {
  const left = validateReport(first), right = validateReport(second);
  compatibleReports(first, second);
  if (first.commit !== second.commit) throw new TypeError('Qualification repeats must measure the same commit');
  if (Date.parse(first.completedAt) >= Date.parse(second.startedAt)) throw new TypeError('Qualification requires two separate serial runs');
  const stability = [];
  for (const [id, row] of left) {
    if (row.status === 'unsupported') continue;
    if (stable(row.metrics) !== stable(right.get(id).metrics)) throw new TypeError('Metric definitions differ: ' + id);
    for (const key of Object.keys(row.metrics)) {
      const before = median(observations(row, key)), after = median(observations(right.get(id), key));
      const change = before === 0 ? after === 0 ? 0 : Infinity : Math.abs(after / before - 1);
      stability.push({id, metric: key, before, after, fractionalDifference: Number.isFinite(change) ? change : null,
        stable: change <= 0.05});
    }
  }
  if (stability.some(entry => !entry.stable)) throw Object.assign(new Error('Repeat-run medians differ by more than 5%'), {stability});
  return {...second, status: 'qualified', qualification: {status: 'stable', rule: 'all same-runner medians within 5%',
    repeat: first, stability, qualifiedAt: new Date().toISOString()}};
}

export function comparePerformance(baseline, candidate, options = {}) {
  const left = validateReport(baseline, {baseline: true}), right = validateReport(candidate);
  // Recheck retained qualification evidence rather than trusting a hand-edited status flag.
  qualifyBaseline(baseline.qualification.repeat, {...baseline, status: 'measured', qualification: undefined});
  compatibleReports(baseline, candidate);
  const threshold = options.threshold ?? 0.05, confidence = options.confidence ?? 0.95;
  if (!(threshold >= 0 && threshold < 1) || !(confidence > 0.5 && confidence < 1)) throw new RangeError('Invalid gate threshold/confidence');
  randomGenerator(options.seed ?? 12012);
  const resamples = options.resamples ?? 10000;
  if (!Number.isInteger(resamples) || resamples < 1000 || resamples > 1000000) throw new RangeError('Invalid bootstrap resample count');
  const results = [];
  for (const [id, row] of left) {
    if (row.status === 'unsupported') continue;
    const next = right.get(id);
    if (stable(row.metrics) !== stable(next.metrics)) throw new TypeError('Metric definitions differ: ' + id);
    for (const [key, metric] of Object.entries(row.metrics)) for (const statistic of metric.statistics) {
      const before = observations(row, key), after = observations(next, key), probability = probabilities[statistic];
      const a = quantile(before, probability), b = quantile(after, probability);
      const effect = a === 0 ? b : metric.direction === 'higher' ? b / a - 1 : 1 - b / a;
      const boundary = a === 0 ? 0 : threshold;
      const comparison = !exceeds(effect, boundary) ? {before: a, after: b, observed: effect, regression: false,
        reason: 'Point estimate does not exceed the regression threshold'} : bootstrapRegression(before, after,
        {...options, threshold, confidence, probability, direction: metric.direction});
      results.push({id, metric: key, statistic, ...comparison});
    }
  }
  return {schemaVersion: 1, suite: 'SF-A05-T12', status: results.some(item => item.regression) ? 'regression' : 'passed',
    baselineCommit: baseline.commit, candidateCommit: candidate.commit, environmentFingerprint: candidate.environmentFingerprint,
    threshold, confidence, multiplicity: 'Per-metric two-sided confidence; no family-wise claim',
    method: 'Independent percentile bootstrap of relative degradation; zero allocation baseline uses absolute increase', results};
}
