/** Deterministic Mulberry32 draws; independent baseline/candidate resampling, no host randomness. */
export function randomGenerator(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be UInt32');
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function requireSamples(values, minimum = 1) {
  if (!Array.isArray(values) || values.length < minimum || values.length > 11001 ||
      values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new TypeError(`Expected ${minimum}–10000 finite nonnegative observations`);
  }
}

function percentile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

/** Linear-interpolated quantiles, including the mean of the middle pair for an even-sized median. */
export function quantile(values, probability) {
  requireSamples(values);
  if (!(probability >= 0 && probability <= 1)) throw new RangeError('Invalid quantile');
  return percentile([...values].sort((left, right) => left - right), probability);
}

export const median = values => quantile(values, 0.5);
export const exceeds = (value, boundary) => value - boundary >
  Number.EPSILON * 8 * Math.max(1, Math.abs(value), Math.abs(boundary));

export function distribution(values) {
  requireSamples(values);
  const sorted = [...values].sort((left, right) => left - right);
  const middle = percentile(sorted, 0.5);
  return {count: values.length, minimum: sorted[0], median: middle, p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99), maximum: sorted.at(-1),
    interquartileRange: percentile(sorted, 0.75) - percentile(sorted, 0.25),
    medianAbsoluteDeviation: median(values.map(value => Math.abs(value - middle)))};
}

export function validateBootstrapOptions(options = {}) {
  const {probability = 0.5, direction = 'higher', threshold = 0.05, confidence = 0.95,
    resamples = 10000, seed = 12012} = options;
  if (!['higher', 'lower'].includes(direction) || !(probability >= 0 && probability <= 1) ||
      !(threshold >= 0 && threshold < 1) || !(confidence > 0.5 && confidence < 1) ||
      !Number.isInteger(resamples) || resamples < 1000 || resamples > 1000000) {
    throw new RangeError('Invalid bootstrap configuration');
  }
  randomGenerator(seed);
  return {probability, direction, threshold, confidence, resamples, seed};
}

/**
 * Independent two-sample percentile bootstrap of excess over the regression budget.
 * Latency: candidate/(1+budget) - baseline; throughput: baseline*(1-budget) - candidate.
 * Testing the interval against zero avoids undefined ratios when allocation resamples contain zero.
 */
export function bootstrapRegression(baseline, candidate, options = {}) {
  requireSamples(baseline, 20);
  requireSamples(candidate, 20);
  const {probability, direction, threshold, confidence, resamples, seed} = validateBootstrapOptions(options);
  if (direction === 'lower' && [...baseline, ...candidate].some(value => value <= 0)) {
    throw new RangeError('Zero throughput is unmeasured');
  }
  const random = randomGenerator(seed);
  const before = quantile(baseline, probability);
  const after = quantile(candidate, probability);
  const absolute = before === 0;
  const observed = absolute ? after - before : direction === 'higher' ? after / before - 1 : 1 - after / before;
  const excess = (left, right) => direction === 'higher' ? right / (1 + threshold) - left : left * (1 - threshold) - right;
  const draws = Array(resamples);
  const leftSample = Array(baseline.length);
  const rightSample = Array(candidate.length);
  const draw = (values, sample) => {
    for (let index = 0; index < sample.length; index++) sample[index] = values[Math.floor(random() * values.length)];
    sample.sort((left, right) => left - right);
    return percentile(sample, probability);
  };
  for (let index = 0; index < resamples; index++) {
    draws[index] = excess(draw(baseline, leftSample), draw(candidate, rightSample));
  }
  draws.sort((left, right) => left - right);
  const alpha = (1 - confidence) / 2;
  const interval = [percentile(draws, alpha), percentile(draws, 1 - alpha)];
  const budgetExcess = excess(before, after);
  const regression = exceeds(budgetExcess, 0) && exceeds(interval[0], 0);
  return {before, after, observed, threshold: absolute ? 0 : threshold, unit: absolute ? 'absolute' : 'fraction',
    budgetExcess, interval, intervalUnit: 'metric-units-over-budget', confidence, resamples, seed,
    method: 'independent-percentile-budget-excess', regression,
    decision: regression ? 'regression' : exceeds(budgetExcess, 0) ? 'inconclusive' : 'within-budget'};
}
