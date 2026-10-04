function range(value, name, min = 0, max = 100) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid ${name}`);
  return value;
}

function bounce(time, options) {
  const count = Math.floor(range(options.bounces ?? 3, 'bounce count', 0, 32));
  const ratio = Math.max(1.001, range(options.bounciness ?? 2, 'bounciness', 0, 100));
  const scale = ratio ** count;
  const total = (scale - 1) / (ratio - 1) + scale / 2;
  const segment = Math.floor(Math.log1p(time * total * (ratio - 1)) / Math.log(ratio));
  const start = (ratio ** segment - 1) / ((ratio - 1) * total);
  const stop = (ratio ** (segment + 1) - 1) / ((ratio - 1) * total);
  const phase = (time - start) / (stop - start);
  return 4 * ratio ** (segment - count) * phase * (1 - phase);
}

const easeIn = Object.freeze({
  Linear: time => time,
  QuadraticEase: time => time * time,
  CubicEase: time => time ** 3,
  QuarticEase: time => time ** 4,
  QuinticEase: time => time ** 5,
  PowerEase: (time, options) => time ** range(options.power ?? 2, 'easing power'),
  SineEase: time => 1 - Math.cos(time * Math.PI / 2),
  CircleEase: time => 1 - Math.sqrt(Math.max(0, 1 - time * time)),
  BackEase: (time, options) => {
    const amplitude = range(options.amplitude ?? 1, 'easing amplitude');
    return time * time * ((amplitude + 1) * time - amplitude);
  },
  BounceEase: bounce,
  ExponentialEase: (time, options) => {
    const exponent = range(options.exponent ?? 2, 'exponent');
    return exponent < 1e-9 ? time : Math.expm1(exponent * time) / Math.expm1(exponent);
  },
  ElasticEase: (time, options) => {
    const oscillations = range(options.oscillations ?? 3, 'oscillations', 0, 64);
    const springiness = range(options.springiness ?? 3, 'springiness');
    const amplitude = springiness < 1e-9 ? time : Math.expm1(springiness * time) / Math.expm1(springiness);
    return amplitude * Math.sin((oscillations * 2 + 0.5) * Math.PI * time);
  }
});

const bezier = (time, first, second) => 3 * (1 - time) ** 2 * time * first + 3 * (1 - time) * time * time * second + time ** 3;

/** Invert a monotonic cubic x curve; bisection handles stationary tangents exactly at boundaries. */
export function cubicBezier(progress, first = [0, 0], second = [1, 1]) {
  for (const point of [first, second]) {
    if (!point || point.length !== 2) throw new TypeError('Cubic Bézier needs two 2D control points');
    range(point[0], 'Bézier control x', 0, 1);
    range(point[1], 'Bézier control y', -100, 100);
  }
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 48; iteration++) {
    const middle = (low + high) / 2;
    if (bezier(middle, first[0], second[0]) < progress) low = middle;
    else high = middle;
  }
  return bezier((low + high) / 2, first[1], second[1]);
}

/** Shared easing data contract for XAML and compositor samplers; progress is normalized. */
export function sampleEasing(progress, options = {}) {
  if (!Number.isFinite(progress)) throw new RangeError('Invalid animation progress');
  const time = Math.min(1, Math.max(0, progress));
  const kind = options.kind ?? 'Linear';
  if (kind === 'CubicBezier' || kind === 'KeySpline') return cubicBezier(time, options.first, options.second);
  if (kind === 'Step') {
    const steps = range(options.steps ?? 1, 'step count', 1, 1000000);
    if (!Number.isInteger(steps)) throw new RangeError('Step count must be an integer');
    return Math.min(1, Math.floor(time * steps + (options.initialStep ?? 0)) / steps);
  }
  const sample = easeIn[kind];
  if (!sample) throw new TypeError(`Unsupported easing function ${kind}`);
  const mode = options.mode ?? 0;
  if (![0, 1, 2].includes(mode)) throw new RangeError('Invalid easing mode');
  sample(0.5, options);
  if (time === 0 || time === 1) return time;
  if (mode === 1 || kind === 'Linear') return sample(time, options);
  if (mode === 0) return 1 - sample(1 - time, options);
  return time < 0.5 ? sample(time * 2, options) / 2 : 1 - sample((1 - time) * 2, options) / 2;
}
