/** Deterministic PRNG for resampling; independent draws for baseline and candidate. */
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
  if (!Array.isArray(values) || values.length < minimum || values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new TypeError(`Expected at least ${minimum} finite nonnegative observations`);
  }
}

/** Linear-interpolated quantiles, including the average of the middle pair for the median. */
export function quantile(values, probability) {
  requireSamples(values);
  if (!(probability >= 0 && probability <= 1)) throw new RangeError('Invalid quantile');
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * probability;
  const lower = Math.floor(position), fraction = position - lower;
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * fraction;
}
export const median = values => quantile(values, 0.5);
export const exceeds = (value, boundary) => value - boundary > Number.EPSILON * 8 * Math.max(1, Math.abs(value), Math.abs(boundary));
export function distribution(values) {
  requireSamples(values);
  return {count: values.length, minimum: Math.min(...values), median: median(values), p95: quantile(values, 0.95),
    p99: quantile(values, 0.99), maximum: Math.max(...values)};
}

/**
 * Independent two-sample percentile bootstrap, following SciPy bootstrap(paired=False, method='percentile').
 * The statistic is relative degradation; at a zero baseline it is an absolute increase, without epsilon imputation.
 */
export function bootstrapRegression(baseline, candidate, options = {}) {
  const {probability = 0.5, direction = 'higher', threshold = 0.05, confidence = 0.95, resamples = 10000, seed = 12012} = options;
  requireSamples(baseline, 20);
  requireSamples(candidate, 20);
  if (!['higher', 'lower'].includes(direction) || !(threshold >= 0 && threshold < 1) || !(confidence > 0.5 && confidence < 1) ||
      !Number.isInteger(resamples) || resamples < 1000 || resamples > 1000000) throw new RangeError('Invalid bootstrap configuration');
  const random = randomGenerator(seed), before = quantile(baseline, probability), after = quantile(candidate, probability);
  const absolute = before === 0;
  if (absolute && direction === 'lower') throw new RangeError('Zero baseline for a throughput metric is unmeasured');
  const effect = (left, right) => absolute ? right - left : direction === 'higher' ? right / left - 1 : 1 - right / left;
  const observed = effect(before, after), bootstrap = [];
  const draw = values => Array.from({length: values.length}, () => values[Math.floor(random() * values.length)]);
  for (let index = 0; index < resamples; index++) {
    const left = quantile(draw(baseline), probability), right = quantile(draw(candidate), probability);
    if (!absolute && left === 0) throw new RangeError('Relative bootstrap sample has a zero denominator');
    bootstrap.push(effect(left, right));
  }
  // Effects can be negative; quantile() intentionally accepts only nonnegative raw observations.
  bootstrap.sort((a, b) => a - b);
  const percentile = fraction => {
    const at = (bootstrap.length - 1) * fraction, low = Math.floor(at);
    return bootstrap[low] + (bootstrap[Math.ceil(at)] - bootstrap[low]) * (at - low);
  };
  const alpha = (1 - confidence) / 2, interval = [percentile(alpha), percentile(1 - alpha)];
  const boundary = absolute ? 0 : threshold;
  return {before, after, observed, interval, threshold: boundary, unit: absolute ? 'absolute' : 'fraction',
    confidence, resamples, seed, method: 'independent-percentile', regression: exceeds(observed, boundary) && exceeds(interval[0], boundary)};
}
