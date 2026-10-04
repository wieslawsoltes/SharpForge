import {distribution, median, randomGenerator, requireSamples} from './statistics.js';

/** Resample whole alternating-order pairs, retaining the covariance of each before/after observation. */
export function pairedTarget(baseline, candidate, target, {seed = 12012, resamples = 10000, confidence = 0.95} = {}) {
  requireSamples(baseline, 20);
  requireSamples(candidate, 20);
  if (baseline.length !== candidate.length || [...baseline, ...candidate].some(value => value <= 0) ||
      !Number.isInteger(resamples) || resamples < 1000 || resamples > 100000 || !(confidence > 0.5 && confidence < 1)) {
    throw new RangeError('Invalid paired target evidence or bootstrap configuration');
  }
  const transforms = {
    'minimum-speedup': (before, after) => before / after,
    'minimum-reduction': (before, after) => 1 - after / before,
    'maximum-overhead': (before, after) => after / before - 1
  };
  const transform = transforms[target.kind];
  if (!transform || !Number.isFinite(target.value) || target.value < 0) throw new RangeError('Unknown performance target');
  const observed = transform(median(baseline), median(candidate));
  const random = randomGenerator(seed);
  const before = Array(baseline.length), after = Array(candidate.length), draws = Array(resamples);
  for (let draw = 0; draw < resamples; draw++) {
    for (let index = 0; index < before.length; index++) {
      const selected = Math.floor(random() * baseline.length);
      before[index] = baseline[selected];
      after[index] = candidate[selected];
    }
    draws[draw] = transform(median(before), median(after));
  }
  draws.sort((left, right) => left - right);
  const percentile = probability => {
    const position = (draws.length - 1) * probability, lower = Math.floor(position);
    return draws[lower] + (draws[Math.ceil(position)] - draws[lower]) * (position - lower);
  };
  const alpha = (1 - confidence) / 2;
  const interval = [percentile(alpha), percentile(1 - alpha)];
  const maximum = target.kind === 'maximum-overhead';
  const meetsPointTarget = maximum ? observed < target.value : observed >= target.value;
  const confirmed = maximum ? interval[1] < target.value : interval[0] >= target.value;
  const missed = maximum ? interval[0] >= target.value : interval[1] < target.value;
  return {...target, observed, interval, meetsPointTarget, acceptance: confirmed ? 'met' : missed ? 'missed' : 'inconclusive',
    method: 'paired-percentile-ratio-of-medians', seed, confidence, resamples};
}

export function summarizeMeasurements(samples) {
  const keys = ['executionMs', 'nanosecondsPerInstruction', 'instructionsPerSecond', 'managedAllocations',
    'managedAllocatedBytes', 'frameArraysAllocated', 'framesAllocated', 'offsetMapAllocations', 'tokenResolutions'];
  const measured = samples.filter(sample => sample.phase === 'measured');
  return Object.fromEntries(keys.filter(key => measured.every(sample => Number.isFinite(sample[key])))
    .map(key => [key, distribution(measured.map(sample => sample[key]))]));
}
